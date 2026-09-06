import { existsSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  countRows,
  DRIZZLE,
  fakeSound,
  getRow,
  getRows,
  offlineCore,
  openTempDb,
  originalBytes,
  originalPath,
  RAIN,
  seedLibrarySound,
  sidecarPath,
  signedInCore,
  sleep,
  stageReady,
  THUNDER,
} from './helpers'

describe('core.saveToLibrary — promotes a Staged Sound, no file move', () => {
  it('writes a library row and drops the staged row, leaving the exact same file on disk', async () => {
    const { core, dataDir, dbPath } = await signedInCore()
    await core.search('rain')
    await stageReady(core, RAIN.id)

    const original = originalPath(dataDir, RAIN)
    const before = statSync(original)

    core.saveToLibrary(RAIN.id)

    const after = statSync(original)
    expect(after.ino).toBe(before.ino)
    expect(readFileSync(original, 'utf8')).toBe(originalBytes(RAIN.id))

    const db = openTempDb(dbPath)
    expect(countRows(db, 'staged_entries', 'sound_id = ?', RAIN.id)).toBe(0)
    const row = getRow<{ saved_at: number }>(
      db,
      'library_entries',
      'sound_id = ?',
      RAIN.id,
    )
    expect(row?.saved_at).toBeGreaterThan(0)

    expect(core.listLibrary().map((s) => s.id)).toEqual([RAIN.id])
  })

  it('is idempotent — a second save is a no-op, no duplicate, saved_at unchanged', async () => {
    const { core, dbPath } = await signedInCore()
    await core.search('rain')
    await stageReady(core, RAIN.id)

    core.saveToLibrary(RAIN.id)
    const db = openTempDb(dbPath)
    const first = getRow<{ saved_at: number }>(
      db,
      'library_entries',
      'sound_id = ?',
      RAIN.id,
    )!.saved_at

    await sleep(6)
    expect(() => core.saveToLibrary(RAIN.id)).not.toThrow()
    core.saveToLibrary(RAIN.id)

    const rows = getRows<{ saved_at: number }>(
      db,
      'library_entries',
      'sound_id = ?',
      RAIN.id,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.saved_at).toBe(first)
  })

  it('throws rather than saving a Sound it has no metadata for', async () => {
    const { core } = await signedInCore()
    expect(() => core.saveToLibrary(99999999)).toThrow(/no metadata/i)
  })
})

describe('core.listLibrary', () => {
  it('orders by date saved — newest first by default, oldest first with dir:asc', async () => {
    const { core } = await signedInCore()
    await core.search('rain')
    await stageReady(core, RAIN.id)
    await stageReady(core, DRIZZLE.id)
    await stageReady(core, THUNDER.id)

    core.saveToLibrary(RAIN.id)
    await sleep(4)
    core.saveToLibrary(DRIZZLE.id)
    await sleep(4)
    core.saveToLibrary(THUNDER.id)

    expect(core.listLibrary().map((s) => s.id)).toEqual([
      THUNDER.id,
      DRIZZLE.id,
      RAIN.id,
    ])
    expect(core.listLibrary({ dir: 'asc' }).map((s) => s.id)).toEqual([
      RAIN.id,
      DRIZZLE.id,
      THUNDER.id,
    ])
  })
})

describe('core.getLibraryMembership', () => {
  it('reports a saved Sound as in-Library and the rest as not', async () => {
    const { core } = await signedInCore()
    const page = await core.search('rain')
    const ids = page.sounds.map((s) => s.id)
    await stageReady(core, RAIN.id)
    core.saveToLibrary(RAIN.id)

    const membership = core.getLibraryMembership(ids)
    expect(membership[RAIN.id]).toBe(true)
    for (const id of ids.filter((i) => i !== RAIN.id)) {
      expect(membership[id]).toBe(false)
    }
    expect(Object.keys(membership).map(Number).sort()).toEqual(
      [...ids].sort((a, b) => a - b),
    )
  })
})

describe('core.deleteFromLibrary', () => {
  it('removes the row AND the Original + sidecar, keeping the sounds metadata row', async () => {
    const { core, dataDir, dbPath } = await signedInCore()
    await core.search('rain')
    await stageReady(core, RAIN.id)
    core.saveToLibrary(RAIN.id)

    const original = originalPath(dataDir, RAIN)
    expect(existsSync(original)).toBe(true)

    await core.deleteFromLibrary(RAIN.id)

    expect(existsSync(original)).toBe(false)
    expect(existsSync(sidecarPath(dataDir, RAIN.id))).toBe(false)
    expect(core.listLibrary()).toEqual([])

    const db = openTempDb(dbPath)
    expect(countRows(db, 'library_entries', 'sound_id = ?', RAIN.id)).toBe(0)
    expect(countRows(db, 'sounds', 'id = ?', RAIN.id)).toBe(1)
    expect(core.getLibraryMembership([RAIN.id])[RAIN.id]).toBe(false)
  })
})

describe('the Library works with the gateway unavailable', () => {
  it('lists, serves paths for and deletes a saved Sound without any gateway call', async () => {
    const { core, dataDir } = await offlineCore()

    const sound = fakeSound(700001, { name: 'offline keeper' })
    await seedLibrarySound(core, dataDir, sound, 'BYTES')

    const listed = core.listLibrary()
    expect(listed.map((s) => s.id)).toEqual([sound.id])
    expect(listed[0]!.name).toBe('offline keeper')

    expect(core.getLibraryMembership([sound.id])[sound.id]).toBe(true)
    expect(core.getContentPath(sound.id)).toBe(originalPath(dataDir, sound))
    expect(core.getFreesoundUrl(sound.id)).toBe(sound.url)

    await core.deleteFromLibrary(sound.id)
    expect(core.listLibrary()).toEqual([])
    expect(existsSync(originalPath(dataDir, sound))).toBe(false)
  })

  it('survives a reopen — the Library is on disk, not in memory', async () => {
    const first = await offlineCore()
    const sound = fakeSound(700002)
    await seedLibrarySound(first.core, first.dataDir, sound, 'BYTES')
    first.core.close()

    const reopened = await offlineCore({ dbPath: first.dbPath })
    expect(reopened.core.listLibrary().map((s) => s.id)).toEqual([sound.id])
  })
})
