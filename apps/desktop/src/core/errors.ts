// Typed errors the core throws. A failed search MUST throw one of these — it is
// never reported as an empty result set.

/** Freesound (or the token Worker) responded, but with an error status. */
export class GatewayError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'GatewayError'
    this.status = status
  }
}

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
