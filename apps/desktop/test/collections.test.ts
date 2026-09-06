import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  countRows,
  fakeSound,
  getRow,
  offlineCore,
  offlineCoreWithLibrary,
  openTempDb,
  originalPath,
  seedOriginal,
} from './helpers'

describe('creating and renaming Collections', () => {
  it('creates a named Collection, visible in listCollections with a zero count', async () => {
    const { core } = await offlineCoreWithLibrary([])
    const made = core.createCollection('  Weather  ')
    expect(made.name).toBe('Weather')
    expect(made.count).toBe(0)
    expect(core.listCollections()).toEqual([
      { id: made.id, name: 'Weather', count: 0 },
    ])
  })

  it('rejects an empty name on create and on rename', async () => {
    const { core } = await offlineCoreWithLibrary([])
    expect(() => core.createCollection('   ')).toThrow(/empty/i)
    const c = core.createCollection('Keep')
    expect(() => core.renameCollection(c.id, '  ')).toThrow(/empty/i)
  })

  it('renames a Collection without touching its members', async () => {
    const { core } = await offlineCoreWithLibrary([1, 2])
    const c = core.createCollection('Draft name')
    core.addToCollection(c.id, [1, 2])
    core.renameCollection(c.id, 'Client — Ferry Ad')

    expect(core.listCollections()).toEqual([
      { id: c.id, name: 'Client — Ferry Ad', count: 2 },
    ])
    expect(
      core
        .listCollectionSounds(c.id)
        .map((s) => s.id)
        .sort(),
    ).toEqual([1, 2])
  })
})

describe('a Sound can belong to multiple Collections at once', () => {
  it('the same Sound appears in every Collection it was added to', async () => {
    const { core } = await offlineCoreWithLibrary([10, 11])
    const weather = core.createCollection('Weather')
    const ferry = core.createCollection('Client — Ferry Ad')

    core.addToCollection(weather.id, [10])
    core.addToCollection(ferry.id, [10, 11])

    expect(core.listCollectionSounds(weather.id).map((s) => s.id)).toEqual([10])
    expect(
      core
        .listCollectionSounds(ferry.id)
        .map((s) => s.id)
        .sort(),
    ).toEqual([10, 11])

    const badges = core.getCollectionsForSounds([10, 11])
    expect(badges[10]!.map((c) => c.name).sort()).toEqual([
      'Client — Ferry Ad',
      'Weather',
    ])
    expect(badges[11]!.map((c) => c.name)).toEqual(['Client — Ferry Ad'])
  })

  it('adding is idempotent — a second add creates no duplicate and does not move added_at', async () => {
    const { core, dbPath } = await offlineCoreWithLibrary([10])
    const c = core.createCollection('Weather')
    core.addToCollection(c.id, [10])
    const db = openTempDb(dbPath)
    const where = 'collection_id = ? AND sound_id = ?'
    const first = getRow<{ added_at: number }>(
      db,
      'collection_members',
      where,
      c.id,
      10,
    )!.added_at

    core.addToCollection(c.id, [10])
    expect(countRows(db, 'collection_members', where, c.id, 10)).toBe(1)
    expect(
      getRow<{ added_at: number }>(db, 'collection_members', where, c.id, 10)!
        .added_at,
    ).toBe(first)
    expect(core.listCollections()[0]!.count).toBe(1)
  })
})

describe('several selected Sounds are added in one action', () => {
  it('batch-adds a mixed selection, skipping the ones already in the Collection', async () => {
    const { core } = await offlineCoreWithLibrary([1, 2, 3, 4])
    const c = core.createCollection('Session')
    core.addToCollection(c.id, [1])
    core.addToCollection(c.id, [1, 2, 3, 4])

    expect(
      core
        .listCollectionSounds(c.id)
        .map((s) => s.id)
        .sort(),
    ).toEqual([1, 2, 3, 4])
    expect(core.listCollections()[0]!.count).toBe(4)
  })

  it('throws for a Sound that is not in the Library, and for an unknown Collection', async () => {
    const { core } = await offlineCoreWithLibrary([1])
    const c = core.createCollection('Session')
    expect(() => core.addToCollection(c.id, [1, 999])).toThrow(
      /not in the library/i,
    )
    expect(() => core.addToCollection(4242, [1])).toThrow(/no collection/i)
  })
})

describe('removing a Sound from a Collection', () => {
  it('leaves it in the Library and in every other Collection', async () => {
    const { core } = await offlineCoreWithLibrary([7])
    const a = core.createCollection('A')
    const b = core.createCollection('B')
    core.addToCollection(a.id, [7])
    core.addToCollection(b.id, [7])

    core.removeFromCollection(a.id, 7)

    expect(core.listCollectionSounds(a.id)).toEqual([])
    expect(core.listCollectionSounds(b.id).map((s) => s.id)).toEqual([7])
    expect(core.getLibraryMembership([7])[7]).toBe(true)
    expect(core.listLibrary().map((s) => s.id)).toEqual([7])
  })

  it('is a no-op when the Sound was not in the Collection', async () => {
    const { core } = await offlineCoreWithLibrary([7])
    const a = core.createCollection('A')
    expect(() => core.removeFromCollection(a.id, 7)).not.toThrow()
    expect(core.listCollections()[0]!.count).toBe(0)
  })
})

describe('deleting a Collection', () => {
  it('leaves all its Sounds in the Library untouched', async () => {
    const { core, dataDir } = await offlineCoreWithLibrary([1, 2])
    const c = core.createCollection('Throwaway')
    core.addToCollection(c.id, [1, 2])

    core.deleteCollection(c.id)

    expect(core.listCollections()).toEqual([])
    expect(
      core
        .listLibrary()
        .map((s) => s.id)
        .sort(),
    ).toEqual([1, 2])
    expect(existsSync(originalPath(dataDir, fakeSound(1)))).toBe(true)
    expect(existsSync(originalPath(dataDir, fakeSound(2)))).toBe(true)
  })

  it('drops the collection_members rows with the Collection', async () => {
    const { core, dbPath } = await offlineCoreWithLibrary([1])
    const c = core.createCollection('Throwaway')
    core.addToCollection(c.id, [1])
    core.deleteCollection(c.id)

    const db = openTempDb(dbPath)
    expect(countRows(db, 'collection_members', 'collection_id = ?', c.id)).toBe(
      0,
    )
  })
})

describe('deleting a Sound from the Library', () => {
  it('removes it from every Collection it belonged to', async () => {
    const { core, dbPath } = await offlineCoreWithLibrary([5, 6])
    const a = core.createCollection('A')
    const b = core.createCollection('B')
    core.addToCollection(a.id, [5, 6])
    core.addToCollection(b.id, [5])

    await core.deleteFromLibrary(5)

    expect(core.listCollectionSounds(a.id).map((s) => s.id)).toEqual([6])
    expect(core.listCollectionSounds(b.id)).toEqual([])
    expect(core.getCollectionsForSounds([5])[5]).toEqual([])

    const db = openTempDb(dbPath)
    expect(countRows(db, 'collection_members', 'sound_id = ?', 5)).toBe(0)
    expect(core.listCollections().find((c) => c.id === a.id)!.count).toBe(1)
  })
})

describe('a Sound is filed into a Collection at the moment it is saved', () => {
  it('saveToLibrary(id, sound, [collectionIds]) saves and files in one action', async () => {
    const tc = await offlineCore()
    const weather = tc.core.createCollection('Weather')
    const ferry = tc.core.createCollection('Client — Ferry Ad')

    const rain = fakeSound(900, { name: 'good rain' })
    await seedOriginal(tc.dataDir, rain)
    tc.core.saveToLibrary(rain.id, rain, [weather.id, ferry.id])

    expect(tc.core.getLibraryMembership([900])[900]).toBe(true)
    expect(tc.core.listCollectionSounds(weather.id).map((s) => s.id)).toEqual([
      900,
    ])
    expect(tc.core.listCollectionSounds(ferry.id).map((s) => s.id)).toEqual([
      900,
    ])
  })

  it('throws (saving nothing) when a named Collection does not exist', async () => {
    const tc = await offlineCore()
    const s = fakeSound(901)
    await seedOriginal(tc.dataDir, s)
    expect(() => tc.core.saveToLibrary(901, s, [77])).toThrow(/no collection/i)
    expect(tc.core.getLibraryMembership([901])[901]).toBe(false)
  })
})

describe('Collections are served from the database', () => {
  it('listCollectionSounds needs no gateway and carries the user overlay', async () => {
    const { core } = await offlineCoreWithLibrary([1, 2])
    const c = core.createCollection('Weather')
    core.addToCollection(c.id, [1, 2])

    core.setCustomName(1, 'my rain')
    core.setLibraryTags(1, ['storm'])

    const sounds = core.listCollectionSounds(c.id)
    const one = sounds.find((s) => s.id === 1)!
    expect(one.customName).toBe('my rain')
    expect(one.effectiveName).toBe('my rain')
    expect(one.customTags).toEqual(['storm'])
  })

  it('membership persists across a restart', async () => {
    const first = await offlineCoreWithLibrary([1, 2])
    const c = first.core.createCollection('Weather')
    first.core.addToCollection(c.id, [1, 2])
    first.core.close()

    const reopened = await offlineCore({
      dbPath: first.dbPath,
      dataDir: first.dataDir,
    })

    expect(reopened.core.listCollections()).toEqual([
      { id: c.id, name: 'Weather', count: 2 },
    ])
    expect(
      reopened.core
        .listCollectionSounds(c.id)
        .map((s) => s.id)
        .sort(),
    ).toEqual([1, 2])
  })
})
