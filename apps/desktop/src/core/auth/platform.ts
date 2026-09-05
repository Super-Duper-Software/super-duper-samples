/** What the loopback listener saw on the single request to `/callback`. */
export interface LoopbackResult {
  /** The `?code=` value, when the callback carried one. */
  code?: string
  /** The `?state=` value, passed straight through for the core to verify. */
  state?: string
  /**
   * Set when no code will arrive: `"timeout"` (the wait was aborted), an OAuth
   * `error=` parameter value, or any other listener-side reason. The core turns
   * this into a `SignInCancelledError`.
   */
  error?: string
}

export interface AwaitLoopbackCodeOptions {
  /** Fixed redirect port. Always 8910 in production (ADR-0004). */
  port: number
  /** Redirect path, `"/callback"`. */
  path: string
  /**
   * Aborted by the core when the sign-in wait budget elapses. The listener must
   * then stop, free the port, and resolve with `{ error: "timeout" }`.
   */
  signal: AbortSignal
}

export interface AuthPlatform {
  /** Open `url` in the user's default browser. Never an in-app window. */
  openExternal(url: string): Promise<void> | void

  /**
   * Bind `port`, accept exactly one request to `path`, reply with a tiny
   * "you can close this tab" page, then shut the server down. Resolves with the
   * captured `code`/`state`. On `signal` abort, stop and resolve
   * `{ error: "timeout" }`. If the port cannot be bound because it is already in
   * use, reject with an error whose `code` is `"EADDRINUSE"` — the core maps that
   * to `LoopbackPortInUseError`.
   */
  awaitLoopbackCode(opts: AwaitLoopbackCodeOptions): Promise<LoopbackResult>

  /** Encrypt bytes with the OS keystore (`safeStorage`). Never `keytar`. */
  encrypt(data: Buffer): Buffer

  /** Reverse of `encrypt`. Throws if the blob is not decryptable on this machine. */
  decrypt(data: Buffer): Buffer
}
