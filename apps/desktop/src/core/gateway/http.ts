import { GatewayError, NetworkError, NotImplemented } from '../errors'
import {
  ReauthRequiredError,
  RetryableTokenError,
} from '../auth/errors'
import { freesoundFilterString, freesoundSortParam } from './freesoundQuery'
import {
  SEARCH_FIELDS,
  type DownloadOriginalOptions,
  type DownloadOriginalResult,
  type FreesoundGateway,
  type FreesoundProfile,
  type GatewaySearchParams,
  type RawSearchPage,
  type TokenSet,
} from './index'

const DEFAULT_BASE_URL = 'https://freesound.org/apiv2/'

/**
 * `Retry-After` is either a number of seconds or an HTTP date. Return seconds, or
 * `undefined` when the header is absent or unparseable (the core then applies its
 * own default).
 */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined
  const secs = Number(header)
  if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs)
  const when = Date.parse(header)
  if (!Number.isNaN(when)) return Math.max(0, Math.ceil((when - Date.now()) / 1000))
  return undefined
}

export interface HttpFreesoundGatewayConfig {
  /**
   * Token Worker base URL (`FREESOUND_TOKEN_WORKER_URL`). The Worker holds
   * `client_secret`; this app never does. Required — without it there is no way
   * to get the bearer token search and download both need (ADR-0004).
   */
  tokenWorkerUrl?: string
  /** Override the API base. Must end with a slash. Defaults to the real API. */
  baseUrl?: string
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
}

/** Wire shape of the Worker's success body (see worker/src/index.ts). */
interface WorkerTokenBody {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
}

/** Wire shape of the Worker's error body. */
interface WorkerErrorBody {
  error?: string
  upstream_status?: number
  detail?: string
  hint?: string
}

/**
 * Real gateway. Every Freesound call — search included — hits
 * `https://freesound.org/apiv2/...` with the signed-in user's OAuth2 bearer
 * token (`Authorization: Bearer <accessToken>`); ADR-0004 explains why no API
 * key is bundled. Token exchange/refresh go to the Cloudflare token Worker.
 */
export class HttpFreesoundGateway implements FreesoundGateway {
  readonly #baseUrl: string
  readonly #tokenWorkerUrl: string | undefined
  readonly #fetch: typeof fetch

  constructor(config: HttpFreesoundGatewayConfig = {}) {
    this.#baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
    this.#tokenWorkerUrl = config.tokenWorkerUrl?.replace(/\/+$/, '')
    this.#fetch = config.fetchImpl ?? globalThis.fetch
  }

  async search(
    params: GatewaySearchParams,
    accessToken: string,
  ): Promise<RawSearchPage> {
    const url = new URL('search/text/', this.#baseUrl)
    url.searchParams.set('query', params.query)
    url.searchParams.set('page', String(params.page))
    url.searchParams.set('page_size', String(params.pageSize))
    url.searchParams.set('fields', SEARCH_FIELDS)

    const sort = freesoundSortParam(params.sort)
    if (sort) url.searchParams.set('sort', sort)
    const filter = freesoundFilterString(params.filter)
    if (filter) url.searchParams.set('filter', filter)

    let res: Response
    try {
      res = await this.#fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    } catch (err) {
      throw new NetworkError('Freesound search request failed', err)
    }

    if (!res.ok) {
      throw new GatewayError(
        `Freesound search returned HTTP ${res.status}`,
        res.status,
        parseRetryAfter(res.headers?.get?.('retry-after') ?? null),
      )
    }

    try {
      return (await res.json()) as RawSearchPage
    } catch (err) {
      throw new GatewayError(`Freesound search returned an unreadable body: ${String(err)}`)
    }
  }

  getPreviewStream(): Promise<never> {
    return Promise.reject(new NotImplemented('getPreviewStream'))
  }

  async downloadOriginal(
    soundId: number,
    accessToken: string,
    opts: DownloadOriginalOptions = {},
  ): Promise<DownloadOriginalResult> {
    const url = new URL(`sounds/${soundId}/download/`, this.#baseUrl)

    let res: Response
    try {
      res = await this.#fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: opts.signal,
      })
    } catch (err) {
      if (opts.signal?.aborted || (err as { name?: string }).name === 'AbortError') {
        throw Object.assign(new Error('download aborted'), { name: 'AbortError' })
      }
      throw new NetworkError('Freesound download request failed', err)
    }

    if (!res.ok) {
      throw new GatewayError(
        `Freesound download of sound ${soundId} returned HTTP ${res.status}`,
        res.status,
        parseRetryAfter(res.headers?.get?.('retry-after') ?? null),
      )
    }

    const contentType = res.headers?.get?.('content-type') ?? null
    const body = res.body
    if (!body) {
      const buf = new Uint8Array(await res.arrayBuffer())
      return { bytes: buf, contentType }
    }

    const reader = body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          chunks.push(value)
          total += value.byteLength
        }
        if (opts.signal?.aborted) {
          await reader.cancel()
          throw Object.assign(new Error('download aborted'), { name: 'AbortError' })
        }
      }
    } catch (err) {
      if (opts.signal?.aborted || (err as { name?: string }).name === 'AbortError') {
        throw Object.assign(new Error('download aborted'), { name: 'AbortError' })
      }
      throw new NetworkError('Freesound download stream failed', err)
    }

    const bytes = new Uint8Array(total)
    let offset = 0
    for (const c of chunks) {
      bytes.set(c, offset)
      offset += c.byteLength
    }
    return { bytes, contentType }
  }

  exchangeToken(code: string, redirectUri: string): Promise<TokenSet> {
    return this.#tokenWorkerCall('/exchange', {
      code,
      redirect_uri: redirectUri,
    })
  }

  refreshToken(refreshToken: string): Promise<TokenSet> {
    return this.#tokenWorkerCall('/refresh', { refresh_token: refreshToken })
  }

  async getMe(accessToken: string): Promise<FreesoundProfile> {
    const url = new URL('me/', this.#baseUrl)
    let res: Response
    try {
      res = await this.#fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    } catch (err) {
      throw new NetworkError('Freesound profile request failed', err)
    }
    if (!res.ok) {
      throw new GatewayError(
        `Freesound /me/ returned HTTP ${res.status}`,
        res.status,
      )
    }
    try {
      const body = (await res.json()) as { username?: string }
      return { username: body.username ?? '' }
    } catch (err) {
      throw new GatewayError(`Freesound /me/ returned an unreadable body: ${String(err)}`)
    }
  }

  async #tokenWorkerCall(
    path: '/exchange' | '/refresh',
    body: Record<string, string>,
  ): Promise<TokenSet> {
    if (!this.#tokenWorkerUrl) {
      throw new GatewayError(
        'FREESOUND_TOKEN_WORKER_URL is not configured — OAuth sign-in is unavailable.',
      )
    }

    let res: Response
    try {
      res = await this.#fetch(`${this.#tokenWorkerUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (err) {
      throw new RetryableTokenError(
        err instanceof Error ? err.message : 'network error contacting the token Worker',
      )
    }

    let parsed: WorkerTokenBody & WorkerErrorBody
    try {
      parsed = (await res.json()) as WorkerTokenBody & WorkerErrorBody
    } catch {
      parsed = {}
    }

    if (!res.ok) {
      const detail = parsed.detail ?? parsed.hint ?? `token Worker HTTP ${res.status}`
      if (parsed.error === 'reauthorize') {
        throw new ReauthRequiredError(detail, parsed.upstream_status)
      }
      if (parsed.error === 'retry') {
        throw new RetryableTokenError(detail, parsed.upstream_status)
      }
      throw new GatewayError(`Token Worker ${path} failed: ${detail}`, res.status)
    }

    if (!parsed.access_token || !parsed.refresh_token) {
      throw new GatewayError(`Token Worker ${path} returned an incomplete token set.`)
    }

    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token,
      expiresIn: typeof parsed.expires_in === 'number' ? parsed.expires_in : 86_400,
      scope: parsed.scope ?? '',
      tokenType: parsed.token_type ?? 'Bearer',
    }
  }
}
