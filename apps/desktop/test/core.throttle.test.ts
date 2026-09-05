import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RETRY_AFTER_SECONDS,
  GatewayError,
  ThrottledError,
} from '../src/core'
import { FakeFreesoundGateway } from '../src/core/gateway/fake'
import { openDb } from '../src/core/db/index'
import { makeFakeGateway, makeTestCore } from './helpers/makeTestCore'

describe('core.search — 429 throttling', () => {
  it('surfaces a 429 as a typed ThrottledError carrying retryAfter (not a generic failure)', async () => {
    const gateway = new FakeFreesoundGateway({ throttle: { retryAfter: 42 } })
    const { core } = await makeTestCore({ signedIn: true, gateway })

    const err = await core.search('rain').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ThrottledError)
    expect((err as ThrottledError).retryAfter).toBe(42)
    expect((err as ThrottledError).status).toBe(429)
    expect(err).toBeInstanceOf(GatewayError)
    expect((err as Error).name).toBe('ThrottledError')
  })

  it('applies a sane default retry window when the response gives no Retry-After', async () => {
    const gateway = new FakeFreesoundGateway({ throttle: {} })
    const { core } = await makeTestCore({ signedIn: true, gateway })

    const err = await core.search('rain').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ThrottledError)
    expect((err as ThrottledError).retryAfter).toBe(DEFAULT_RETRY_AFTER_SECONDS)
  })

  it('a 429 on a cache miss writes no cache row', async () => {
    const gateway = new FakeFreesoundGateway({ throttle: { retryAfter: 10 } })
    const { core, dbPath } = await makeTestCore({ signedIn: true, gateway })

    await core.search('rain').catch(() => {})

    const db = openDb(dbPath)
    const n = (
      db.prepare('SELECT COUNT(*) AS n FROM search_cache').get() as { n: number }
    ).n
    db.close()
    expect(n).toBe(0)
  })

  it('a generic 500 stays a plain GatewayError, not a ThrottledError', async () => {
    const gateway = makeFakeGateway({
      failWith: new GatewayError('server error', 500),
    })
    const { core } = await makeTestCore({ signedIn: true, gateway })

    const err = await core.search('rain').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(GatewayError)
    expect(err).not.toBeInstanceOf(ThrottledError)
  })
})
