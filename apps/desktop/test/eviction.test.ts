import { existsSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createRecordingDragHost } from '../src/core'
import type { DB } from '../src/core/db/index'
import {
  clearStaged as clearStagedStore,
  computeDiskUsage,
  DEFAULT_STAGING_BYTE_BUDGET,
  evictStagedOverBudget,
} from '../src/core/staging/eviction'
import {
  countRows,
  craftStaged,
  DRIZZLE,
  fakeSound,
  listContent,
  openTempDb,
  originalByteLength,
  originalPath,
  RAIN,
  readSidecar,
  signedInCore,
  sidecarPath,
  stageReady,
  THUNDER,
  waitUntil,
} from './helpers'

/** Nothing is being dragged out — no file is pinned. */
const NO_DRAGS = { has: () => false }

/** A crafted Staged Sound with a chosen size and last-accessed time. */
const staged = (
  db: DB,
  dataDir: string,
  id: number,
  opts: { bytes?: number; lastAccess?: number } = {},
) => craftStaged(db, dataDir, fakeSound(id, { name: `Sound ${id}` }), opts)

describe('a sidecar accompanies every download', () => {
  it('a staged Original lands with its `<id>.json` sidecar and no partial temp file', async () => {
    const { core, dataDir } = await signedInCore()
    await core.search('rain')

    await stageReady(core, RAIN.id)

    expect(existsSync(originalPath(dataDir, RAIN))).toBe(true)
    expect(existsSync(sidecarPath(dataDir, RAIN.id))).toBe(true)

    const sidecar = readSidecar(sidecarPath(dataDir, RAIN.id))
    expect(sidecar.soundId).toBe(RAIN.id)
    expect(sidecar.author.username).toBeTruthy()
    expect(sidecar.license.url).toMatch(/creativecommons\.org|freesound/i)
    expect(sidecar.freesoundUrl).toContain(`/${RAIN.id}/`)
    expect(sidecar.sound.id).toBe(RAIN.id)

    expect(listContent(dataDir).some((f) => f.endsWith('.part'))).toBe(false)
  })
})

describe('evictStagedOverBudget — LRU-first, whole-Sound removal', () => {
  it('evicts least-recently-accessed Staged sounds first until within budget', async () => {
    const { dataDir, dbPath } = await signedInCore()
    const db = openTempDb(dbPath)

    const a = await staged(db, dataDir, 9001, {
      bytes: 100,
      lastAccess: 1_000,
    })
    const b = await staged(db, dataDir, 9002, {
      bytes: 100,
      lastAccess: 2_000,
    })
    const c = await staged(db, dataDir, 9003, {
      bytes: 100,
      lastAccess: 3_000,
    })

    const outcome = await evictStagedOverBudget(db, dataDir, 150, NO_DRAGS)

    expect(outcome.evicted).toEqual([9001, 9002])
    expect(outcome.freedBytes).toBe(200)

    for (const p of [a, b]) {
      expect(existsSync(p.original)).toBe(false)
      expect(existsSync(p.sidecar)).toBe(false)
    }
    expect(existsSync(c.original)).toBe(true)
    expect(existsSync(c.sidecar)).toBe(true)

    const rows = db
      .prepare('SELECT sound_id FROM staged_entries ORDER BY sound_id')
      .all() as { sound_id: number }[]
    expect(rows.map((r) => r.sound_id)).toEqual([9003])
  })

  it('is a no-op while total Staged bytes are within budget', async () => {
    const { dataDir, dbPath } = await signedInCore()
    const db = openTempDb(dbPath)
    const a = await staged(db, dataDir, 9101, { bytes: 100 })

    const outcome = await evictStagedOverBudget(
      db,
      dataDir,
      DEFAULT_STAGING_BYTE_BUDGET,
      NO_DRAGS,
    )

    expect(outcome.evicted).toEqual([])
    expect(existsSync(a.original)).toBe(true)
  })

  it('never removes a Sound that is in the Library', async () => {
    const { dataDir, dbPath } = await signedInCore()
    const db = openTempDb(dbPath)

    const kept = await staged(db, dataDir, 9201, {
      bytes: 100,
      lastAccess: 1_000,
    })
    const other = await staged(db, dataDir, 9202, {
      bytes: 100,
      lastAccess: 2_000,
    })
    db.prepare(
      'INSERT INTO library_entries (sound_id, saved_at) VALUES (?, ?)',
    ).run(9201, Date.now())

    const outcome = await evictStagedOverBudget(db, dataDir, 0, NO_DRAGS)

    expect(outcome.skipped).toContain(9201)
    expect(outcome.evicted).toEqual([9202])
    expect(existsSync(kept.original)).toBe(true)
    expect(existsSync(kept.sidecar)).toBe(true)
    expect(existsSync(other.original)).toBe(false)
  })

  it('never removes a file a live Drag-Out hardlink still needs', async () => {
    const { dataDir, dbPath } = await signedInCore()
    const db = openTempDb(dbPath)

    const dragging = await staged(db, dataDir, 9301, {
      bytes: 100,
      lastAccess: 1_000,
    })
    const other = await staged(db, dataDir, 9302, {
      bytes: 100,
      lastAccess: 2_000,
    })

    const inFlight = { has: (id: number) => id === 9301 }
    const outcome = await evictStagedOverBudget(db, dataDir, 0, inFlight)

    expect(outcome.skipped).toContain(9301)
    expect(outcome.evicted).toEqual([9302])
    expect(existsSync(dragging.original)).toBe(true)
    expect(existsSync(other.original)).toBe(false)
  })
})

describe('core.stageOnAudition — a stage over budget triggers LRU eviction', () => {
  it('exceeding the budget evicts the least-recently-used Staged sound, silently', async () => {
    const { core, dataDir } = await signedInCore({
      stagingByteBudget: originalByteLength(RAIN.id) + 5,
    })
    await core.search('rain')

    await stageReady(core, RAIN.id)
    await stageReady(core, DRIZZLE.id)

    await waitUntil(
      () =>
        !existsSync(originalPath(dataDir, RAIN)) &&
        !existsSync(sidecarPath(dataDir, RAIN.id)),
    )
    expect(existsSync(originalPath(dataDir, DRIZZLE))).toBe(true)
    expect(existsSync(sidecarPath(dataDir, DRIZZLE.id))).toBe(true)

    await waitUntil(
      () => core.getStagingStatus([RAIN.id])[RAIN.id] === 'not-started',
    )
  })

  it('spares a Sound with a live Drag-Out and evicts the next-oldest instead', async () => {
    const host = createRecordingDragHost({ multiFileDragSupported: false })
    const { core, dataDir } = await signedInCore({
      stagingByteBudget:
        originalByteLength(RAIN.id) + originalByteLength(DRIZZLE.id) + 5,
      dragHost: host,
    })
    await core.search('rain')

    await stageReady(core, RAIN.id, 8000)
    await stageReady(core, DRIZZLE.id, 8000)

    core.startDrag(RAIN.id)
    await stageReady(core, THUNDER.id, 8000)

    await waitUntil(
      () =>
        !existsSync(originalPath(dataDir, DRIZZLE)) &&
        !existsSync(sidecarPath(dataDir, DRIZZLE.id)),
      8000,
    )
    expect(existsSync(originalPath(dataDir, RAIN))).toBe(true)
    expect(existsSync(originalPath(dataDir, THUNDER))).toBe(true)

    core.endDrag(RAIN.id)
    await stageReady(core, DRIZZLE.id, 8000)
    await waitUntil(
      () =>
        !existsSync(originalPath(dataDir, RAIN)) &&
        !existsSync(sidecarPath(dataDir, RAIN.id)),
      8000,
    )
  }, 20000)
})

describe('core.getDiskUsage', () => {
  it('splits the on-disk footprint between Staged and Library bytes', async () => {
    const { core, dataDir, dbPath } = await signedInCore()
    await core.search('rain')
    await stageReady(core, RAIN.id)
    await stageReady(core, DRIZZLE.id)

    const db = openTempDb(dbPath)
    db.prepare(
      'INSERT INTO library_entries (sound_id, saved_at) VALUES (?, ?)',
    ).run(RAIN.id, Date.now())
    db.prepare('DELETE FROM staged_entries WHERE sound_id = ?').run(RAIN.id)

    const usage = await core.getDiskUsage()
    expect(usage.staged).toBe(originalByteLength(DRIZZLE.id))
    expect(usage.library).toBe(statSync(originalPath(dataDir, RAIN)).size)
    expect(usage.total).toBe(usage.staged + usage.library)
  })
})

describe('core.clearStaged', () => {
  it('removes every Staged Original + sidecar + row, leaving the Library untouched', async () => {
    const { core, dataDir, dbPath } = await signedInCore()
    await core.search('rain')
    await stageReady(core, RAIN.id)
    await stageReady(core, DRIZZLE.id)

    const db = openTempDb(dbPath)
    db.prepare(
      'INSERT INTO library_entries (sound_id, saved_at) VALUES (?, ?)',
    ).run(RAIN.id, Date.now())
    db.prepare('DELETE FROM staged_entries WHERE sound_id = ?').run(RAIN.id)

    const outcome = await core.clearStaged()

    expect(outcome.evicted).toEqual([DRIZZLE.id])

    expect(existsSync(originalPath(dataDir, DRIZZLE))).toBe(false)
    expect(existsSync(sidecarPath(dataDir, DRIZZLE.id))).toBe(false)
    expect(countRows(db, 'staged_entries')).toBe(0)

    expect(existsSync(originalPath(dataDir, RAIN))).toBe(true)
    expect(existsSync(sidecarPath(dataDir, RAIN.id))).toBe(true)
    expect(countRows(db, 'library_entries')).toBe(1)
  })

  it('skips a Sound with a live Drag-Out', async () => {
    const { dataDir, dbPath } = await signedInCore()
    const db = openTempDb(dbPath)
    const dragging = await staged(db, dataDir, 9401, { bytes: 40 })
    const plain = await staged(db, dataDir, 9402, { bytes: 40 })

    const outcome = await clearStagedStore(db, dataDir, {
      has: (id: number) => id === 9401,
    })

    expect(outcome.skipped).toEqual([9401])
    expect(outcome.evicted).toEqual([9402])
    expect(existsSync(dragging.original)).toBe(true)
    expect(existsSync(plain.original)).toBe(false)
  })
})

describe('computeDiskUsage', () => {
  it('reports zero for an untouched core', async () => {
    const { dataDir, dbPath } = await signedInCore()
    const db = openTempDb(dbPath)
    expect(await computeDiskUsage(db, dataDir)).toEqual({
      staged: 0,
      library: 0,
      total: 0,
    })
  })
})
