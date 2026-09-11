/** What the loopback listener saw on the single request to `/callback`. */
export interface LoopbackResult {
  code?: string
  /** Passed straight through for the core to verify. */
  state?: string
  /** Set when no code will arrive: `"timeout"`, an OAuth `error=` value, or any other reason. */
  error?: string
}

export interface AwaitLoopbackCodeOptions {
  /** Always 8910 in production. */
  port: number
  /** Redirect path, `"/callback"`. */
  path: string
  /** On abort the listener must stop, free the port, and resolve `{ error: "timeout" }`. */
  signal: AbortSignal
}

export interface AuthPlatform {
  /** Open `url` in the user's default browser. Never an in-app window. */
  openExternal(url: string): Promise<void> | void

  /**
   * Bind `port`, accept exactly one request to `path`, reply with a "you can
   * close this tab" page, then shut down. Rejects with `code: "EADDRINUSE"` when
   * the port is taken — the core maps that to `LoopbackPortInUseError`.
   */
  awaitLoopbackCode(opts: AwaitLoopbackCodeOptions): Promise<LoopbackResult>

  /** Encrypt bytes with the OS keystore (`safeStorage`). Never `keytar`. */
  encrypt(data: Buffer): Buffer

  /** Reverse of `encrypt`. Throws if the blob is not decryptable on this machine. */
  decrypt(data: Buffer): Buffer
}
