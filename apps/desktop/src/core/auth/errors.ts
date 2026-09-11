/**
 * The grant is dead and refreshing cannot recover it (the Worker answered
 * `{ error: "reauthorize" }`). The only cure is a fresh interactive sign-in; the
 * core clears the stored refresh token and sets `reauthRequired`.
 */
export class ReauthRequiredError extends Error {
  /** Upstream Freesound HTTP status, as reported by the Worker (if any). */
  readonly upstreamStatus?: number
  readonly detail?: string

  constructor(detail?: string, upstreamStatus?: number) {
    super('Freesound sign-in has expired — please sign in again.')
    this.name = 'ReauthRequiredError'
    this.detail = detail
    this.upstreamStatus = upstreamStatus
  }
}

/**
 * A transient token exchange/refresh failure (the Worker answered
 * `{ error: "retry" }`). The grant is still good. The core never loops on this:
 * a proactive refresh reschedules once, a 401-interceptor refresh propagates it.
 */
export class RetryableTokenError extends Error {
  readonly upstreamStatus?: number
  readonly detail?: string

  constructor(detail?: string, upstreamStatus?: number) {
    super('Could not reach the Freesound token service — try again shortly.')
    this.name = 'RetryableTokenError'
    this.detail = detail
    this.upstreamStatus = upstreamStatus
  }
}

/**
 * Another process holds the fixed OAuth redirect port. Exactly one redirect URI
 * is registered with Freesound, so the port cannot be varied — the
 * user has to free it.
 */
export class LoopbackPortInUseError extends Error {
  readonly port: number

  constructor(port: number) {
    super(
      `Sign-in failed: port ${port} is already in use — close whatever is using it and try again.`,
    )
    this.name = 'LoopbackPortInUseError'
    this.port = port
  }
}

/**
 * The callback's `state` did not match the one generated for this sign-in — a
 * stale redirect or a forgery. Nothing is exchanged.
 */
export class OAuthStateMismatchError extends Error {
  constructor() {
    super(
      'Sign-in failed: the browser response did not match this app’s request (state mismatch).',
    )
    this.name = 'OAuthStateMismatchError'
  }
}

/** Sign-in ended without a code: the tab was closed, access denied, or it timed out. */
export class SignInCancelledError extends Error {
  /** Raw reason from the listener (`timeout`, an OAuth `error=` param, …). */
  readonly reason?: string

  constructor(reason?: string) {
    super(
      reason === 'timeout'
        ? 'Sign-in timed out before it was authorized in the browser.'
        : 'Sign-in was cancelled before it completed.',
    )
    this.name = 'SignInCancelledError'
    this.reason = reason
  }
}
