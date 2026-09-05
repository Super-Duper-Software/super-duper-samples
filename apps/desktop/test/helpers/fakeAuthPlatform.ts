import type {
  AuthPlatform,
  AwaitLoopbackCodeOptions,
  LoopbackResult,
} from '../../src/core'

/**
 * Reversible but NOT plaintext: `FAKEENC:` + base64. A test can therefore assert
 * both "the stored blob equals what encrypt() returned" and "the stored blob
 * does not contain the raw refresh token".
 */
const PREFIX = 'FAKEENC:'

export class FakeAuthPlatform implements AuthPlatform {
  /** Every URL passed to `openExternal`, in order. */
  readonly openedUrls: string[] = []
  /** Every buffer passed to `encrypt`, in order (the plaintext inputs). */
  readonly encryptInputs: Buffer[] = []
  readonly decryptInputs: Buffer[] = []

  /**
   * How the loopback listener resolves. `'echo-state'` (default) returns the
   * exact `state` the core put in the authorize URL, with `code: 'fake-code'`.
   * Otherwise the object is returned verbatim (use for wrong-state / error).
   */
  loopback: 'echo-state' | LoopbackResult = 'echo-state'
  /** When true, `awaitLoopbackCode` rejects with an EADDRINUSE error. */
  portInUse = false
  /** When true, ignore `loopback` and never resolve until `signal` aborts. */
  hang = false

  #lastState: string | undefined

  openExternal(url: string): void {
    this.openedUrls.push(url)
    try {
      this.#lastState = new URL(url).searchParams.get('state') ?? undefined
    } catch {
      this.#lastState = undefined
    }
  }

  awaitLoopbackCode(opts: AwaitLoopbackCodeOptions): Promise<LoopbackResult> {
    if (this.portInUse) {
      const err = Object.assign(
        new Error(`listen EADDRINUSE: address already in use :::${opts.port}`),
        { code: 'EADDRINUSE' },
      )
      return Promise.reject(err)
    }
    return new Promise<LoopbackResult>((resolve) => {
      opts.signal.addEventListener('abort', () => resolve({ error: 'timeout' }))
      if (this.hang) return
      setImmediate(() => {
        if (opts.signal.aborted) return
        resolve(
          this.loopback === 'echo-state'
            ? { code: 'fake-code', state: this.#lastState }
            : this.loopback,
        )
      })
    })
  }

  encrypt(data: Buffer): Buffer {
    this.encryptInputs.push(Buffer.from(data))
    return Buffer.from(PREFIX + data.toString('base64'), 'utf8')
  }

  decrypt(data: Buffer): Buffer {
    this.decryptInputs.push(Buffer.from(data))
    const s = data.toString('utf8')
    if (!s.startsWith(PREFIX)) {
      throw new Error('FakeAuthPlatform.decrypt: not a FAKEENC blob')
    }
    return Buffer.from(s.slice(PREFIX.length), 'base64')
  }
}
