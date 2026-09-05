import { describe, expect, it } from 'vitest'
import type { Sound } from '../src/core'
import { FakeFreesoundGateway } from '../src/core/gateway/fake'
import { loadFixture, makeTestCore } from './helpers/makeTestCore'

/** The fields the renderer's result row binds to — must be stable page to page. */
function rowKeys(s: Sound): string[] {
  return Object.keys(s).sort()
}

describe('core.search pagination', () => {
  it('reports hasMore when the loaded pages do not yet cover totalCount', async () => {
    const { core } = await makeTestCore({ signedIn: true })

    const first = await core.search('rain', { page: 1 })

    expect(first.totalCount).toBe(1873)
    expect(first.hasMore).toBe(true)
  })

  it('reports hasMore=false on a fully-contained single page', async () => {
    const { core } = await makeTestCore({ signedIn: true })

    const only = await core.search('thunder', { page: 1 })

    expect(only.totalCount).toBe(2)
    expect(only.hasMore).toBe(false)
  })

  it('walks page N and returns a stable result shape each page', async () => {
    const { core } = await makeTestCore({ signedIn: true })

    const p1 = await core.search('loops', { page: 1, pageSize: 3 })
    const p2 = await core.search('loops', { page: 2, pageSize: 3 })

    expect(p1.page).toBe(1)
    expect(p2.page).toBe(2)
    expect(p1.pageSize).toBe(3)
    expect(p2.pageSize).toBe(3)
    expect(p1.totalCount).toBe(6)
    expect(p2.totalCount).toBe(6)
    expect(p1.query).toBe('loops')
    expect(p2.query).toBe('loops')

    expect(p1.hasMore).toBe(true)
    expect(p2.hasMore).toBe(false)

    expect(p1.sounds).toHaveLength(3)
    expect(p2.sounds).toHaveLength(3)
    expect(rowKeys(p2.sounds[0]!)).toEqual(rowKeys(p1.sounds[0]!))

    const ids = [...p1.sounds, ...p2.sounds].map((s) => s.id)
    expect(new Set(ids).size).toBe(6)
  })

  it('a page past the end is an empty page, not a failure, and stops pagination', async () => {
    const { core } = await makeTestCore({ signedIn: true })

    const past = await core.search('loops', { page: 3, pageSize: 3 })

    expect(past.sounds).toEqual([])
    expect(past.totalCount).toBe(6)
    expect(past.hasMore).toBe(false)
  })

  it('each page costs exactly one gateway call', async () => {
    const gateway = new FakeFreesoundGateway({
      pagedPages: {
        loops: [
          loadFixture('search-loops-p1.json'),
          loadFixture('search-loops-p2.json'),
        ],
      },
    })
    const { core } = await makeTestCore({ signedIn: true, gateway })

    await core.search('loops', { page: 1, pageSize: 3 })
    await core.search('loops', { page: 2, pageSize: 3 })

    expect(gateway.searchCallCount).toBe(2)
    expect(gateway.calls).toEqual([
      { query: 'loops', page: 1, pageSize: 3 },
      { query: 'loops', page: 2, pageSize: 3 },
    ])
  })
})
