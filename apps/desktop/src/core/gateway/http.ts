import { GatewayError, NetworkError, NotImplemented } from '../errors'
import {
  SEARCH_FIELDS,
  type FreesoundGateway,
  type GatewaySearchParams,
  type RawSearchPage,
} from './index'

const DEFAULT_BASE_URL = 'https://freesound.org/apiv2/'

export interface HttpFreesoundGatewayConfig {
  /** Freesound token-auth API key. Supplied by the main process from config. */
  apiKey: string
  /** Override the API base. Must end with a slash. Defaults to the real API. */
  baseUrl?: string
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
}

/**
 * Real gateway: hits `https://freesound.org/apiv2/search/text/` with token auth
 * (`Authorization: Token <key>`), NOT OAuth. Search and Preview work signed-out.
 */
export class HttpFreesoundGateway implements FreesoundGateway {
  readonly #apiKey: string
  readonly #baseUrl: string
  readonly #fetch: typeof fetch

  constructor(config: HttpFreesoundGatewayConfig) {
    this.#apiKey = config.apiKey
    this.#baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
    this.#fetch = config.fetchImpl ?? globalThis.fetch
  }

  async search(params: GatewaySearchParams): Promise<RawSearchPage> {
    const url = new URL('search/text/', this.#baseUrl)
    url.searchParams.set('query', params.query)
    url.searchParams.set('page', String(params.page))
    url.searchParams.set('page_size', String(params.pageSize))
    url.searchParams.set('fields', SEARCH_FIELDS)

    let res: Response
    try {
      res = await this.#fetch(url, {
        headers: { Authorization: `Token ${this.#apiKey}` },
      })
    } catch (err) {
      throw new NetworkError('Freesound search request failed', err)
    }

    if (!res.ok) {
      throw new GatewayError(
        `Freesound search returned HTTP ${res.status}`,
        res.status,
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

  downloadOriginal(): Promise<never> {
    return Promise.reject(new NotImplemented('downloadOriginal'))
  }

  exchangeToken(): Promise<never> {
    return Promise.reject(new NotImplemented('exchangeToken'))
  }

  refreshToken(): Promise<never> {
    return Promise.reject(new NotImplemented('refreshToken'))
  }
}
