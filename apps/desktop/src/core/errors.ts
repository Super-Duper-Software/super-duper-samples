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

/**
 * A download was deliberately cancelled — the user moved past the Sound before
 * its Original finished staging (ticket 08). Distinct from a failure: the
 * download queue neither retries it nor marks the Sound `failed`. The gateway
 * throws this (or any error whose `name` is `AbortError`) when the caller's
 * `AbortSignal` fires mid-stream.
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
    (!!err && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError')
  )
}

/**
 * Sign-in is required or has failed (ticket 18). Distinct from a `GatewayError`
 * so the renderer can say "sign in to download" rather than "download failed".
 */
export class AuthError extends Error {
  constructor(message = 'You need to be signed in for this.') {
    super(message)
    this.name = 'AuthError'
  }
}

/**
 * Writing to disk failed — out of space, permission denied, path gone (ticket
 * 18). `ENOSPC` is called out separately because it is the one the user can act
 * on (free space) versus a permissions problem they usually cannot.
 */
export class DiskError extends Error {
  readonly code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'DiskError'
    this.code = code
  }
}

// ---- surfacing errors in the UI (ticket 18) ---------------------------------

/**
 * The distinct failure categories the shell reports differently. The ticket
 * names them: connectivity, throttling, authentication, download and disk — plus
 * `unknown` for anything unclassified.
 */
export type ErrorKind =
  | 'network'
  | 'throttled'
  | 'auth'
  | 'download'
  | 'disk'
  | 'unknown'

export interface ClassifiedError {
  kind: ErrorKind
  /** A few words for the notification heading. */
  title: string
  /**
   * One sentence of body text. When `actionable` it says what to do; when not,
   * it says so plainly rather than suggesting a fix that does not exist.
   */
  detail: string
  /** Is there something the user can actually do about this? */
  actionable: boolean
  /** Seconds until a retry is worth trying — only ever set for `throttled`. */
  retryAfter: number | null
}

function nameOf(e: unknown): string {
  if (e instanceof Error) return e.name
  if (e && typeof e === 'object' && typeof (e as { name?: unknown }).name === 'string') {
    return (e as { name: string }).name
  }
  return ''
}
function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') {
    return (e as { message: string }).message
  }
  return String(e ?? '')
}

/**
 * Turn any thrown value — including one that has crossed the IPC boundary and
 * lost its prototype — into a renderable, categorised error. `name` survives
 * structured-clone; `retryAfter` may not, so the message is a fallback source
 * for the number. This is the single classifier the renderer uses everywhere;
 * it must not depend on `instanceof` alone.
 */
export function classifyError(e: unknown): ClassifiedError {
  const name = nameOf(e)
  const message = messageOf(e)
  const anyE = (e ?? {}) as Record<string, unknown>

  if (name === 'ThrottledError' || /rate.?limit/i.test(message)) {
    const field = typeof anyE['retryAfter'] === 'number' ? (anyE['retryAfter'] as number) : null
    const fromMsg = message.match(/(\d+)\s*s/)
    const retryAfter = field ?? (fromMsg ? Number(fromMsg[1]) : DEFAULT_RETRY_AFTER_SECONDS)
    return {
      kind: 'throttled',
      title: 'Freesound rate limit hit',
      detail: `Too many requests. This clears on its own — try again in about ${retryAfter}s.`,
      actionable: true,
      retryAfter,
    }
  }

  if (name === 'NetworkError' || /network|offline|fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(message)) {
    return {
      kind: 'network',
      title: 'No connection to Freesound',
      detail: 'Check your internet connection, then try again. Your Library still works offline.',
      actionable: true,
      retryAfter: null,
    }
  }

  if (
    name === 'AuthError' ||
    name === 'ReauthRequiredError' ||
    name === 'OAuthStateMismatchError' ||
    name === 'SignInCancelledError' ||
    /sign(ed)?.?in|not authorized|unauthori[sz]ed|401/i.test(message)
  ) {
    return {
      kind: 'auth',
      title: 'Sign-in needed',
      detail: 'Sign in with your Freesound account to download Originals and drag them out.',
      actionable: true,
      retryAfter: null,
    }
  }

  if (name === 'LoopbackPortInUseError' || /EADDRINUSE/i.test(message)) {
    return {
      kind: 'auth',
      title: 'Could not start sign-in',
      detail: 'Port 8910 is in use by another program. Close it and try signing in again.',
      actionable: true,
      retryAfter: null,
    }
  }

  if (name === 'DiskError' || /ENOSPC|EACCES|EROFS|EPERM|disk|no space/i.test(message)) {
    const noSpace = /ENOSPC|no space/i.test(message) || anyE['code'] === 'ENOSPC'
    return {
      kind: 'disk',
      title: noSpace ? 'Disk is full' : 'Could not write to disk',
      detail: noSpace
        ? 'Free up some space on this device, then try again.'
        : 'The app could not write to its data folder. Check the folder’s permissions.',
      actionable: true,
      retryAfter: null,
    }
  }

  if (name === 'DownloadCancelledError' || name === 'AbortError') {
    return {
      kind: 'download',
      title: 'Download stopped',
      detail: 'You moved on before this finished downloading. Play it again to retry.',
      actionable: true,
      retryAfter: null,
    }
  }

  if (name === 'GatewayError' || /freesound|gateway|5\d\d/i.test(message)) {
    return {
      kind: 'download',
      title: 'Freesound returned an error',
      detail: 'This is a problem on Freesound’s side, not something you can fix. Try again later.',
      actionable: false,
      retryAfter: null,
    }
  }

  return {
    kind: 'unknown',
    title: 'Something went wrong',
    detail: message || 'An unexpected error occurred. The details are in the app log.',
    actionable: false,
    retryAfter: null,
  }
}
