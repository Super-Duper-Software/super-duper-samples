import { describe, expect, it } from 'vitest'
import { createSearchController } from '../src/core/searchController'
import type { SearchResult } from '../src/core'
import { makeFakeGateway, makeTestCore } from './helpers/makeTestCore'

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('debounce — core SearchController', () => {
  it('collapses rapid queries into a single gateway call for the trailing query', async () => {
    const gateway = makeFakeGateway()
    const { core } = await makeTestCore({ gateway, debounceMs: 25 })

    // Five "keystrokes" inside one debounce window. (thunder: single-page
    // fixture, so no next-page prefetch muddies the call count.)
    const results = Promise.all([
      core.searchDebounced('t'),
      core.searchDebounced('th'),
      core.searchDebounced('thu'),
      core.searchDebounced('thunder '),
      core.searchDebounced('thunder'),
    ])

    const [a, , , , e] = await results

    expect(gateway.searchCallCount).toBe(1)
    expect(gateway.calls[0]!.query).toBe('thunder')
    // Every waiter in the window resolves with the trailing result.
    expect(a).toEqual(e)
    expect(e.sounds.length).toBeGreaterThan(0)
  })

  it('a query issued after the window settles is a new gateway call', async () => {
    const gateway = makeFakeGateway()
    const { core } = await makeTestCore({ gateway, debounceMs: 15 })

    await core.searchDebounced('thunder')
    await tick(30)
    await core.searchDebounced('rain')

    // First page of each distinct query (ignoring any background prefetch).
    expect(gateway.calls.filter((c) => c.page === 1).map((c) => c.query)).toEqual([
      'thunder',
      'rain',
    ])
  })

  it('a debounced query already in the cache costs no gateway call', async () => {
    const gateway = makeFakeGateway()
    const { core } = await makeTestCore({ gateway, debounceMs: 10 })

    await core.searchDebounced('thunder')
    const after = gateway.searchCallCount
    await core.searchDebounced('thunder')

    expect(gateway.searchCallCount).toBe(after)
  })

  it('the controller unit collapses calls against a stub core', async () => {
    let calls = 0
    const stub = {
      async search(query: string): Promise<SearchResult> {
        calls++
        return {
          query,
          totalCount: 0,
          page: 1,
          pageSize: 15,
          sounds: [],
          hasMore: false,
        }
      },
    }
    const controller = createSearchController(stub, { debounceMs: 20 })

    await Promise.all([
      controller.query('a'),
      controller.query('ab'),
      controller.query('abc'),
    ])

    expect(calls).toBe(1)
    controller.dispose()
  })
})
