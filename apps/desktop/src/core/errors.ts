/** Freesound (or the token Worker) responded, but with an error status. */
export class GatewayError extends Error {
  readonly status?: number
  /** Seconds to wait before retrying, when the response said so (e.g. `Retry-After` on a 429). */
  readonly retryAfter?: number

  constructor(message: string, status?: number, retryAfter?: number) {
    super(message)
    this.name = 'GatewayError'
    this.status = status
    this.retryAfter = retryAfter
  }
}

/** HTTP 429. `retryAfter` is always a number of seconds. */
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

/** A FreesoundGateway method that is declared but not built yet. */
export class NotImplemented extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet`)
    this.name = 'NotImplemented'
  }
}

/**
 * A download was deliberately cancelled. The queue neither retries it nor marks
 * the Sound `failed`.
 */
export class DownloadCancelledError extends Error {
  constructor(soundId?: number) {
    super(
      soundId == null
        ? 'The download was cancelled.'
        : `The download of sound ${soundId} was cancelled.`,
    )
    this.name = 'DownloadCancelledError'
  }
}

/** True for both `DownloadCancelledError` and a stdlib `AbortError`. */
export function isAbortError(err: unknown): boolean {
  return (
    err instanceof DownloadCancelledError ||
    (!!err &&
      typeof err === 'object' &&
      (err as { name?: unknown }).name === 'AbortError')
  )
}

/** Sign-in is required or has failed. */
export class AuthError extends Error {
  constructor(message = 'You need to be signed in for this.') {
    super(message)
    this.name = 'AuthError'
  }
}

/** A Freesound read was attempted while signed out; rejected before touching the network. */
export class NotSignedInError extends Error {
  constructor(message = 'Sign in with your Freesound account to search.') {
    super(message)
    this.name = 'NotSignedInError'
  }
}

/** Writing to disk failed. `code` carries the errno (`ENOSPC`, `EACCES`, …) when known. */
export class DiskError extends Error {
  readonly code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'DiskError'
    this.code = code
  }
}

export type {
  ClassifiedError,
  ErrorKind,
} from './classifyError'
export { classifyError } from './classifyError'
