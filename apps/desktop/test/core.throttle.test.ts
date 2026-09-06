import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RETRY_AFTER_SECONDS,
  GatewayError,
  ThrottledError,
} from '../src/core'
import { FakeFreesoundGateway } from '../src/core/gateway/fake'
import {
  countRows,
  makeFakeGateway,
  openTempDb,
  signedInCore,
} from './helpers'

describe('core.search — 429 throttling', () => {
  it('surfaces a 429 as a typed ThrottledError carrying retryAfter (not a generic failure)', async () => {
    const gateway = new FakeFreesoundGateway({ throttle: { retryAfter: 42 } })
    const { core } = await signedInCore({ gateway })

    const err = await core.search('rain').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ThrottledError)
    expect((err as ThrottledError).retryAfter).toBe(42)
    expect((err as ThrottledError).status).toBe(429)
    expect(err).toBeInstanceOf(GatewayError)
    expect((err as Error).name).toBe('ThrottledError')
  })

  it('applies a sane default retry window when the response gives no Retry-After', async () => {
    const gateway = new FakeFreesoundGateway({ throttle: {} })
    const { core } = await signedInCore({ gateway })

    const err = await core.search('rain').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ThrottledError)
    expect((err as ThrottledError).retryAfter).toBe(DEFAULT_RETRY_AFTER_SECONDS)
  })

  it('a 429 on a cache miss writes no cache row', async () => {
    const gateway = new FakeFreesoundGateway({ throttle: { retryAfter: 10 } })
    const { core, dbPath } = await signedInCore({ gateway })

    await core.search('rain').catch(() => {})

    expect(countRows(openTempDb(dbPath), 'search_cache')).toBe(0)
  })

  it('a generic 500 stays a plain GatewayError, not a ThrottledError', async () => {
    const gateway = makeFakeGateway({
      failWith: new GatewayError('server error', 500),
    })
    const { core } = await signedInCore({ gateway })

    const err = await core.search('rain').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(GatewayError)
    expect(err).not.toBeInstanceOf(ThrottledError)
  })
})
