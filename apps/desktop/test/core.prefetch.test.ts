import { describe, expect, it } from 'vitest'
import { FakeFreesoundGateway } from '../src/core/gateway/fake'
import { loadFixture, makeTestCore } from './helpers/makeTestCore'

describe('core.search — next-page prefetch', () => {
  it('after page 1 resolves, page 2 costs no additional gateway call', async () => {
    const gateway = new FakeFreesoundGateway({
      pagedPages: {
        loops: [loadFixture('search-loops-p1.json'), loadFixture('search-loops-p2.json')],
      },
    })
    const { core } = await makeTestCore({ gateway })

    await core.search('loops', { page: 1, pageSize: 3 })

    // The page-1 miss triggered exactly one background fetch: page 2.
    expect(gateway.calls).toEqual([
      { query: 'loops', page: 1, pageSize: 3 },
      { query: 'loops', page: 2, pageSize: 3 },
    ])

    const p2 = await core.search('loops', { page: 2, pageSize: 3 })

    // Served from the prefetched cache / in-flight promise — still just 2 calls.
    expect(gateway.searchCallCount).toBe(2)
    expect(p2.page).toBe(2)
    expect(p2.sounds.map((s) => s.id)).toEqual([500004, 500005, 500006])
  })

  it('does not prefetch past the last page and does not double-prefetch', async () => {
    const gateway = new FakeFreesoundGateway({
      pagedPages: {
        loops: [loadFixture('search-loops-p1.json'), loadFixture('search-loops-p2.json')],
      },
    })
    const { core } = await makeTestCore({ gateway })

    await core.search('loops', { page: 1, pageSize: 3 }) // prefetches p2
    await core.search('loops', { page: 2, pageSize: 3 }) // last page, hasMore=false

    // p1 + p2 only. Page 2 is the last page, so no page-3 prefetch; and the
    // explicit page-2 call did not re-fetch what page 1 already prefetched.
    expect(gateway.searchCallCount).toBe(2)
  })
})
