import { GatewayError, NotImplemented } from '../errors'
import type {
  FreesoundGateway,
  GatewaySearchParams,
  RawSearchPage,
} from './index'

export interface FakeFreesoundGatewayConfig {
  /** Recorded pages keyed by exact query string. */
  pages?: Record<string, RawSearchPage>
  /** Page returned for any query with no entry in `pages`. */
  defaultPage?: RawSearchPage
  /** If set, every `search` call rejects with this error instead of returning. */
  failWith?: Error
}

/**
 * Test gateway driven by recorded JSON fixtures. Records every call so tests can
 * assert that one search costs exactly one gateway call and nothing follows it.
 */
export class FakeFreesoundGateway implements FreesoundGateway {
  /** Every `search` call, in order. */
  readonly calls: GatewaySearchParams[] = []

  #config: FakeFreesoundGatewayConfig

  constructor(config: FakeFreesoundGatewayConfig = {}) {
    this.#config = config
  }

  get searchCallCount(): number {
    return this.calls.length
  }

  async search(params: GatewaySearchParams): Promise<RawSearchPage> {
    this.calls.push({ ...params })

    if (this.#config.failWith) throw this.#config.failWith

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
