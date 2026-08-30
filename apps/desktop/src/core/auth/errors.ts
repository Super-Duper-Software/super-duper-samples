// Typed errors the auth subsystem throws. Kept separate from `src/core/errors.ts`
// so the OAuth vocabulary (reauthorize / retry / port-in-use / state mismatch)
// lives in one place. All of these travel over IPC by `name`, so the renderer can
// branch on `err.name` even after structured-clone drops the prototype.

/**
 * The OAuth grant is dead and cannot be recovered by refreshing: the Worker
 * answered `{ error: "reauthorize" }` (Freesound said `invalid_grant`, the code
 * or refresh token expired, was revoked, or the client is wrong). The only cure
 * is a fresh interactive sign-in. The core clears the stored refresh token and
 * transitions to `signedOut` with `reauthRequired: true`.
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
 * A transient failure exchanging or refreshing a token: the Worker answered
 * `{ error: "retry" }` (Freesound 5xx / 429, or a network error reaching it).
 * The grant is still good; the caller may try again later with backoff. The core
 * never loops on this — a proactive refresh reschedules once, a 401-interceptor
 * refresh simply propagates it and stays signed in.
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
 * The loopback listener could not bind the fixed OAuth redirect port, because
 * another process already holds it. Freesound registers exactly one redirect URI
 * (`http://localhost:8910/callback`, ADR-0004) so the port cannot be varied —
 * the user has to free it. The message names the port and the fix.
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
 * The `state` value on the OAuth callback did not match the one this app
 * generated for the sign-in it started. The response is discarded — it may be a
 * stale redirect or a forgery — and sign-in fails without exchanging anything.
 */
export class OAuthStateMismatchError extends Error {
  constructor() {
    super(
      'Sign-in failed: the browser response did not match this app’s request (state mismatch).',
    )
    this.name = 'OAuthStateMismatchError'
  }
}

/**
 * Sign-in ended without an authorization code: the user closed the tab, denied
 * access, or the wait timed out. Not an error condition the user needs to act on
 * beyond trying again.
 */
export class SignInCancelledError extends Error {
  /** Raw reason from the loopback listener, when it supplied one (`timeout`, an OAuth `error=` param, …). */
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
