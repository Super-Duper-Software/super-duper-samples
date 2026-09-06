import { describe, expect, it } from 'vitest'
import { NetworkError } from '../src/core'
import { FakeFreesoundGateway } from '../src/core/gateway/fake'
import {
  countRows,
  getRow,
  loadFixture,
  makeFakeGateway,
  openTempDb,
  signedInCore,
} from './helpers'

describe('core.search — SQLite cache', () => {
  it('a repeated query makes no gateway call (cache hit)', async () => {
    const gateway = makeFakeGateway()
    const { core } = await signedInCore({ gateway })

    await core.search('thunder')
    const callsAfterFirst = gateway.searchCallCount
    await core.search('thunder')
    await core.search('thunder')

    expect(gateway.searchCallCount).toBe(callsAfterFirst)
  })

  it('a result page costs exactly one gateway call regardless of page size', async () => {
    const gateway = new FakeFreesoundGateway({
      pages: { thunder: loadFixture('search-thunder.json') }, // count 2, hasMore=false
    })
    const { core } = await signedInCore({ gateway })

    await core.search('thunder', { pageSize: 200 })

    expect(gateway.searchCallCount).toBe(1)
  })

  it('returning to a previous query after moving away is instant and gateway-call-free', async () => {
    const gateway = makeFakeGateway()
    const { core } = await signedInCore({ gateway })

    await core.search('rain')
    await core.search('thunder')
    const calls = gateway.searchCallCount

    const back = await core.search('rain')

    expect(gateway.searchCallCount).toBe(calls)
    expect(back.sounds.length).toBeGreaterThan(0)
    expect(back.totalCount).toBe(1873)
  })

  it('cached and live results are identical in shape', async () => {
    const gateway = makeFakeGateway()
    const { core } = await signedInCore({ gateway })

    const live = await core.search('rain')
    const cached = await core.search('rain')

    expect(cached).toEqual(live)
    expect(Object.keys(cached).sort()).toEqual(Object.keys(live).sort())
    expect(Object.keys(cached.sounds[0]!).sort()).toEqual(
      Object.keys(live.sounds[0]!).sort(),
    )
  })

  it('persists Sound metadata from the search response into the sounds table', async () => {
    const { core, dbPath } = await signedInCore()

    const res = await core.search('rain')

    const row = getRow<Record<string, unknown>>(
      openTempDb(dbPath),
      'sounds',
      'id = ?',
      res.sounds[0]!.id,
    )!

    expect(row).toBeDefined()
    expect(row['name']).toBe(res.sounds[0]!.name)
    expect(row['license_name']).toBe(res.sounds[0]!.license.name)
    expect(JSON.parse(row['tags'] as string)).toEqual(res.sounds[0]!.tags)
  })

  it('a connectivity failure on a cache MISS throws and persists nothing (no bogus empty cache row)', async () => {
    const gateway = makeFakeGateway({ failWith: new NetworkError('offline') })
    const { core, dbPath } = await signedInCore({ gateway })

    await expect(core.search('rain')).rejects.toBeInstanceOf(NetworkError)

    const db = openTempDb(dbPath)
    const cacheRows = countRows(db, 'search_cache')
    const soundRows = countRows(db, 'sounds')

    expect(cacheRows).toBe(0)
    expect(soundRows).toBe(0)
  })
})
