import { describe, expect, it } from 'vitest'
import { NetworkError } from '../src/core'
import { FakeFreesoundGateway } from '../src/core/gateway/fake'
import { openDb } from '../src/core/db/index'
import { loadFixture, makeFakeGateway, makeTestCore } from './helpers/makeTestCore'

describe('core.search — SQLite cache', () => {
  it('a repeated query makes no gateway call (cache hit)', async () => {
    const gateway = makeFakeGateway()
    const { core } = await makeTestCore({ signedIn: true, gateway })

    await core.search('thunder')
    const callsAfterFirst = gateway.searchCallCount
    await core.search('thunder')
    await core.search('thunder')

    expect(gateway.searchCallCount).toBe(callsAfterFirst) // no further calls
  })

  it('a result page costs exactly one gateway call regardless of page size', async () => {
    const gateway = new FakeFreesoundGateway({
      pages: { thunder: loadFixture('search-thunder.json') }, // count 2, hasMore=false
    })
    const { core } = await makeTestCore({ signedIn: true, gateway })

    await core.search('thunder', { pageSize: 200 })

    expect(gateway.searchCallCount).toBe(1)
  })

  it('returning to a previous query after moving away is instant and gateway-call-free', async () => {
    const gateway = makeFakeGateway()
    const { core } = await makeTestCore({ signedIn: true, gateway })

    await core.search('rain') // miss
    await core.search('thunder') // miss, different query
    const calls = gateway.searchCallCount

    const back = await core.search('rain') // must be served from cache

    expect(gateway.searchCallCount).toBe(calls)
    expect(back.sounds.length).toBeGreaterThan(0)
    expect(back.totalCount).toBe(1873)
  })

  it('cached and live results are identical in shape', async () => {
    const gateway = makeFakeGateway()
    const { core } = await makeTestCore({ signedIn: true, gateway })

    const live = await core.search('rain') // gateway
    const cached = await core.search('rain') // SQLite

    expect(cached).toEqual(live)
    expect(Object.keys(cached).sort()).toEqual(Object.keys(live).sort())
    expect(Object.keys(cached.sounds[0]!).sort()).toEqual(
      Object.keys(live.sounds[0]!).sort(),
    )
  })

  it('persists Sound metadata from the search response into the sounds table', async () => {
    const { core, dbPath } = await makeTestCore({ signedIn: true })

    const res = await core.search('rain')

    const db = openDb(dbPath)
    const row = db
      .prepare('SELECT * FROM sounds WHERE id = ?')
      .get(res.sounds[0]!.id) as Record<string, unknown>
    db.close()

    expect(row).toBeDefined()
    expect(row['name']).toBe(res.sounds[0]!.name)
    expect(row['license_name']).toBe(res.sounds[0]!.license.name)
    expect(JSON.parse(row['tags'] as string)).toEqual(res.sounds[0]!.tags)
  })

  it('a connectivity failure on a cache MISS throws and persists nothing (no bogus empty cache row)', async () => {
    const gateway = makeFakeGateway({ failWith: new NetworkError('offline') })
    const { core, dbPath } = await makeTestCore({ signedIn: true, gateway })

    await expect(core.search('rain')).rejects.toBeInstanceOf(NetworkError)

    const db = openDb(dbPath)
    const cacheRows = (
      db.prepare('SELECT COUNT(*) AS n FROM search_cache').get() as { n: number }
    ).n
    const soundRows = (
      db.prepare('SELECT COUNT(*) AS n FROM sounds').get() as { n: number }
    ).n
    db.close()

    // Nothing cached, so a later retry still reaches the gateway rather than
    // being served a poisoned empty page.
    expect(cacheRows).toBe(0)
    expect(soundRows).toBe(0)
  })
})
