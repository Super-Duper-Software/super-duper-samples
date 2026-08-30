import { GatewayError, NotImplemented } from '../errors'
import { ReauthRequiredError, RetryableTokenError } from '../auth/errors'
import type {
  DownloadOriginalOptions,
  DownloadOriginalResult,
  FreesoundGateway,
  FreesoundProfile,
  GatewaySearchParams,
  RawSearchPage,
  TokenSet,
} from './index'

/** How the fake should answer the next `refreshToken` call. */
export type FakeRefreshMode = 'ok' | 'reauthorize' | 'retry'

export interface FakeFreesoundGatewayConfig {
  /** Recorded pages keyed by exact query string. */
  pages?: Record<string, RawSearchPage>
  /**
   * Multi-page fixtures keyed by exact query string: `pagedPages[query][n]` is
   * the response for `page: n + 1`. A request past the end of the array yields an
   * empty page carrying the same `count`, matching how Freesound behaves once the
   * caller pages beyond the last result. Takes precedence over `pages`.
   */
  pagedPages?: Record<string, RawSearchPage[]>
  /** Page returned for any query with no entry in `pages`. */
  defaultPage?: RawSearchPage
  /** If set, every `search` call rejects with this error instead of returning. */
  failWith?: Error
  /**
   * If set, every `search` call rejects with a 429 `GatewayError` carrying this
   * `Retry-After` (seconds), exactly as the real gateway does when Freesound
   * rate-limits. Takes precedence over `failWith`.
   */
  throttle?: { retryAfter?: number }

  // ---- OAuth (ticket 07) --------------------------------------------------

  /** Access token `exchangeToken` hands back (and the base for refreshed ones). */
  accessToken?: string
  /** Refresh token `exchangeToken` hands back. */
  refreshToken?: string
  /** `expires_in` seconds for every issued token set. Defaults to 86400 (24h). */
  expiresIn?: number
  /** Username `getMe` returns. Defaults to `"fake-user"`. */
  username?: string
  /** How `refreshToken` behaves. Defaults to `'ok'`. */
  refreshMode?: FakeRefreshMode
  /**
   * Number of leading `getMe` calls that throw `GatewayError(status 401)` before
   * succeeding — drives the "exactly one refresh + one retry" interceptor test.
   */
  getMeUnauthorizedTimes?: number

  // ---- Original download (ticket 08) -----------------------------------

  /**
   * Bytes handed back by a successful `downloadOriginal`. When a function, it is
   * called per sound id. Defaults to a small deterministic buffer derived from
   * the id.
   */
  downloadBytes?: Uint8Array | ((soundId: number) => Uint8Array)
  /** `Content-Type` a successful `downloadOriginal` reports. Defaults to `audio/x-wav`. */
  downloadContentType?: string
  /**
   * Simulated transfer latency in ms. During this wait the call is abort-aware:
   * if `opts.signal` fires it rejects with an `AbortError`. Defaults to 0.
   */
  downloadDelayMs?: number
  /**
   * Per-sound count of leading `downloadOriginal` calls that throw a transient
   * `GatewayError(503)` before finally succeeding — drives the retry test.
   */
  downloadTransientFailures?: number
  /** When set, every `downloadOriginal` throws a `GatewayError(500)` — the permanent-failure path. */
  downloadPermanentFail?: boolean
  /**
   * Per-sound count of leading `downloadOriginal` calls that throw
   * `GatewayError(401)` before succeeding — drives the authenticated-401 →
   * one-refresh-one-retry test.
   */
  downloadUnauthorizedTimes?: number
}

/**
 * Test gateway driven by recorded JSON fixtures. Records every call so tests can
 * assert that one search costs exactly one gateway call and nothing follows it,
 * and (ticket 07) that a 401 causes exactly one refresh and one retry.
 */
export class FakeFreesoundGateway implements FreesoundGateway {
  /** Every `search` call, in order. */
  readonly calls: GatewaySearchParams[] = []
  /** `[code, redirectUri]` for every `exchangeToken` call, in order. */
  readonly exchangeCalls: Array<[string, string]> = []
  /** The `refreshToken` argument for every `refreshToken` call, in order. */
  readonly refreshCalls: string[] = []
  /** The access token passed to every `getMe` call, in order. */
  readonly getMeCalls: string[] = []
  /** `{ soundId, accessToken }` for every `downloadOriginal` call, in order. */
  readonly downloadCalls: Array<{ soundId: number; accessToken: string }> = []

  /** Downloads currently executing (between call and settle). */
  downloadInFlight = 0
  /** The high-water mark of `downloadInFlight` across the fake's lifetime. */
  downloadMaxConcurrent = 0

  #config: FakeFreesoundGatewayConfig
  #refreshSeq = 0
  #getMe401Left: number
  /** Per-sound remaining transient failures / 401s. */
  #dlTransientLeft = new Map<number, number>()
  #dl401Left = new Map<number, number>()

  constructor(config: FakeFreesoundGatewayConfig = {}) {
    this.#config = config
    this.#getMe401Left = config.getMeUnauthorizedTimes ?? 0
  }

  get searchCallCount(): number {
    return this.calls.length
  }

  /** How many `downloadOriginal` calls have been made. */
  get downloadCallCount(): number {
    return this.downloadCalls.length
  }

  /** Change the refresh behaviour mid-test (e.g. after a successful sign-in). */
  setRefreshMode(mode: FakeRefreshMode): void {
    this.#config = { ...this.#config, refreshMode: mode }
  }

  /** Arm N future `getMe` calls to answer 401 before succeeding. */
  armGetMeUnauthorized(times: number): void {
    this.#getMe401Left = times
  }

  async search(params: GatewaySearchParams): Promise<RawSearchPage> {
    // Record the FULL params — including the ticket-15 `sort` and a copy of the
    // structured `filter` — so a test can assert exactly what the core asked
    // for. Fixtures are still served by `query` alone (tests assert on the
    // request, not on new fixture bodies).
    this.calls.push({
      ...params,
      ...(params.filter ? { filter: { ...params.filter } } : {}),
    })

    if (this.#config.throttle) {
      const { retryAfter } = this.#config.throttle
      throw new GatewayError('Freesound search returned HTTP 429', 429, retryAfter)
    }
    if (this.#config.failWith) throw this.#config.failWith

    const paged = this.#config.pagedPages?.[params.query]
    if (paged) {
      const hit = paged[params.page - 1]
      if (hit) return hit
      return { count: paged[0]?.count ?? 0, next: null, previous: null, results: [] }
    }

    const page =
      this.#config.pages?.[params.query] ?? this.#config.defaultPage
    if (!page) {
      throw new GatewayError(
        `FakeFreesoundGateway has no fixture for query "${params.query}"`,
      )
    }
    return page
  }

  getPreviewStream(): Promise<never> {
    return Promise.reject(new NotImplemented('getPreviewStream'))
  }

  async downloadOriginal(
    soundId: number,
    accessToken: string,
    opts: DownloadOriginalOptions = {},
  ): Promise<DownloadOriginalResult> {
    this.downloadCalls.push({ soundId, accessToken })
    this.downloadInFlight += 1
    this.downloadMaxConcurrent = Math.max(
      this.downloadMaxConcurrent,
      this.downloadInFlight,
    )
    try {
      const delay = this.#config.downloadDelayMs ?? 0
      if (delay > 0) await this.#abortableDelay(delay, opts.signal)
      if (opts.signal?.aborted) {
        throw Object.assign(new Error('download aborted'), { name: 'AbortError' })
      }

      if (this.#config.downloadPermanentFail) {
        throw new GatewayError(`fake: permanent download failure for ${soundId}`, 500)
      }

      const n401 =
        this.#dl401Left.get(soundId) ??
        this.#config.downloadUnauthorizedTimes ??
        0
      if (n401 > 0) {
        this.#dl401Left.set(soundId, n401 - 1)
        throw new GatewayError(`fake: download 401 for ${soundId}`, 401)
      }

      const nTransient =
        this.#dlTransientLeft.get(soundId) ??
        this.#config.downloadTransientFailures ??
        0
      if (nTransient > 0) {
        this.#dlTransientLeft.set(soundId, nTransient - 1)
        throw new GatewayError(`fake: transient download failure for ${soundId}`, 503)
      }

      const b = this.#config.downloadBytes
      const bytes =
        typeof b === 'function'
          ? b(soundId)
          : b ?? new TextEncoder().encode(`FAKE-ORIGINAL:${soundId}`)
      return {
        bytes,
        contentType: this.#config.downloadContentType ?? 'audio/x-wav',
      }
    } finally {
      this.downloadInFlight -= 1
    }
  }

  #abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(Object.assign(new Error('download aborted'), { name: 'AbortError' }))
        return
      }
      const timer = setTimeout(resolve, ms)
      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(Object.assign(new Error('download aborted'), { name: 'AbortError' }))
      })
    })
  }

  async exchangeToken(code: string, redirectUri: string): Promise<TokenSet> {
    this.exchangeCalls.push([code, redirectUri])
    return this.#issue(this.#config.refreshToken ?? 'fake-refresh-token')
  }

  async refreshToken(refreshToken: string): Promise<TokenSet> {
    this.refreshCalls.push(refreshToken)
    const mode = this.#config.refreshMode ?? 'ok'
    if (mode === 'reauthorize') {
      throw new ReauthRequiredError('fake: refresh token revoked', 401)
    }
    if (mode === 'retry') {
      throw new RetryableTokenError('fake: token service unavailable', 503)
    }
    // A refresh rotates the refresh token, exactly like Freesound.
    return this.#issue(`fake-refresh-token-${++this.#refreshSeq}`)
  }

  async getMe(accessToken: string): Promise<FreesoundProfile> {
    this.getMeCalls.push(accessToken)
    if (this.#getMe401Left > 0) {
      this.#getMe401Left -= 1
      throw new GatewayError('Freesound /me/ returned HTTP 401', 401)
    }
    return { username: this.#config.username ?? 'fake-user' }
  }

  #issue(refreshToken: string): TokenSet {
    return {
      accessToken:
        this.#refreshSeq === 0
          ? this.#config.accessToken ?? 'fake-access-token'
          : `fake-access-token-${this.#refreshSeq}`,
      refreshToken,
      expiresIn: this.#config.expiresIn ?? 86_400,
      scope: 'read write',
      tokenType: 'Bearer',
    }
  }
}
