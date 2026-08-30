// Typed errors the core throws. A failed search MUST throw one of these — it is
// never reported as an empty result set.

/** Freesound (or the token Worker) responded, but with an error status. */
export class GatewayError extends Error {
  readonly status?: number
  /**
   * Seconds the caller should wait before retrying, when the response said so
   * (e.g. a `Retry-After` header on a 429). The core turns a 429 carrying this
   * into a `ThrottledError`.
   */
  readonly retryAfter?: number

  constructor(message: string, status?: number, retryAfter?: number) {
    super(message)
    this.name = 'GatewayError'
    this.status = status
    this.retryAfter = retryAfter
  }
}

/**
 * The API rate limit was hit (HTTP 429). Distinct from a generic `GatewayError`
 * so the renderer can say "rate-limited, retry in Ns" rather than "search
 * failed". Extends `GatewayError` so existing `instanceof GatewayError` checks
 * still hold. `retryAfter` is always a number of seconds (a sane default when the
 * response gave no `Retry-After`).
 */
export class ThrottledError extends GatewayError {
  override readonly retryAfter: number

  constructor(retryAfter: number, message?: string) {
    super(
      message ?? `Rate-limited by Freesound. Retry in ${retryAfter}s.`,
      429,
      retryAfter,
    )
    this.name = 'ThrottledError'
    this.retryAfter = retryAfter
  }
}

/** Default wait when a 429 carries no usable `Retry-After` (seconds). */
export const DEFAULT_RETRY_AFTER_SECONDS = 60

/** The request never completed — offline, DNS failure, connection reset, timeout. */
export class NetworkError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'NetworkError'
  }
}

/** A FreesoundGateway method that is declared for a later ticket but not built yet. */
export class NotImplemented extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet`)
    this.name = 'NotImplemented'
  }
}
