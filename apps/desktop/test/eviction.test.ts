// Ticket 10 — sidecars and LRU eviction, at the core seam. No Electron: real
// temp SQLite, real temp filesystem, the fake gateway. Eviction's pure functions
// are exercised directly for deterministic LRU ordering; the trigger, the
// in-flight-drag skip, `clearStaged` and `getDiskUsage` are exercised through
// the core.
//
// Covers the ticket's test list:
//   - a sidecar accompanies every download
//   - exceeding the byte budget evicts least-recently-used first
//   - eviction skips Library sounds
//   - eviction skips files a live Drag-Out hardlink still needs
//   - a Sound's audio and sidecar are removed together (no orphans)
//   - clearing Staged material leaves the Library untouched

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRecordingDragHost } from '../src/core'
import { openDb, type DB } from '../src/core/db/index'
import { upsertSound } from '../src/core/db/sounds'
import { upsertStagedEntry } from '../src/core/db/staged'
import { writeOriginal, type Sidecar } from '../src/core/staging/contentStore'
import {
  clearStaged as clearStagedStore,
  computeDiskUsage,
  DEFAULT_STAGING_BYTE_BUDGET,
  evictStagedOverBudget,
} from '../src/core/staging/eviction'
import type { Sound } from '../src/core/types'
import { makeFakeGateway, makeTestCore } from './helpers/makeTestCore'

const RAIN_ID = 321967 // Rain_Heavy_Loop.wav
const DRIZZLE_ID = 408535 // light rain on window.flac
const THUNDER_ID = 17185 // rain-thunder.aiff

/** Bytes the fake gateway serves for a sound id — used to size the budget. */
const bodyLen = (id: number): number => `FAKE-ORIGINAL:${id}`.length

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const c of cleanups.splice(0)) {
    try {
      c()
    } catch {
      /* ignore */
    }
  }
})

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms))

// Eviction fires on `setImmediate` + real async `node:fs`, and this polls with
// real timers, so the ceiling has to absorb CPU contention when the whole suite
// runs its files in parallel — a true failure still trips it, just later.
async function waitUntil(pred: () => boolean, ms = 8000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('waitUntil timed out')
    await sleep(5)
  }
}

/** A signed-in, consenting core (optionally with a recording DragHost). */
async function signedInCore(
  opts: Parameters<typeof makeTestCore>[0] = {},
) {
  const gateway = opts.gateway ?? makeFakeGateway()
  const tc = await makeTestCore({ ...opts, gateway })
  cleanups.push(() => tc.core.close())
  await tc.core.signIn()
  tc.core.grantStagingConsent()
  return tc
}

function openTemp(dbPath: string): DB {
  const db = openDb(dbPath)
  cleanups.push(() => {
    try {
      db.close()
    } catch {
      /* already closed */
    }
  })
  return db
}

async function stageReady(
  core: Awaited<ReturnType<typeof signedInCore>>['core'],
  id: number,
): Promise<void> {
  core.stageOnAudition(id)
  await waitUntil(() => core.getStagingStatus([id])[id] === 'ready')
}

/** Write a `sounds` row + a real Original + sidecar + a `staged_entries` row. */
async function craftStaged(
  db: DB,
  dataDir: string,
  base: Sound,
  id: number,
  { bytes = 60, lastAccess = Date.now(), name = `Sound ${id}` } = {},
): Promise<{ sound: Sound; original: string; sidecar: string }> {
  const sound: Sound = { ...base, id, name, type: 'wav' }
  upsertSound(db, sound)
  const { byteSize, paths } = await writeOriginal(
    dataDir,
    sound,
    new Uint8Array(bytes),
    lastAccess,
  )
  upsertStagedEntry(db, {
    soundId: id,
    byteSize,
    path: paths.original,
    now: lastAccess,
  })
  return { sound, original: paths.original, sidecar: paths.sidecar }
}

const NO_DRAGS = { has: () => false }

// ───────────────────────────── sidecars ─────────────────────────────

describe('a sidecar accompanies every download', () => {
  it('a staged Original lands with its `<id>.json` sidecar and no partial temp file', async () => {
    const { core, dataDir } = await signedInCore()
    await core.search('rain')

    await stageReady(core, RAIN_ID)

    const contentDir = join(dataDir, 'content')
    const original = join(contentDir, `${RAIN_ID}.wav`)
    const sidecarPath = join(contentDir, `${RAIN_ID}.json`)

    expect(existsSync(original)).toBe(true)
    expect(existsSync(sidecarPath)).toBe(true)

    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')) as Sidecar
    expect(sidecar.soundId).toBe(RAIN_ID)
    expect(sidecar.author.username).toBeTruthy()
    expect(sidecar.license.url).toMatch(/creativecommons\.org|freesound/i)
    expect(sidecar.freesoundUrl).toContain(`/${RAIN_ID}/`)
    expect(sidecar.sound.id).toBe(RAIN_ID)

    // atomic rename left nothing behind
    const { readdirSync } = await import('node:fs')
    expect(readdirSync(contentDir).some((f) => f.endsWith('.part'))).toBe(false)
  })
})

// ─────────────────────── LRU eviction (pure) ────────────────────────

describe('evictStagedOverBudget — LRU-first, whole-Sound removal', () => {
  it('evicts least-recently-accessed Staged sounds first until within budget', async () => {
    const { core, dataDir, dbPath } = await signedInCore()
    const base = (await core.search('rain')).sounds.find((s) => s.id === RAIN_ID)!
    const db = openTemp(dbPath)

    const a = await craftStaged(db, dataDir, base, 9001, { bytes: 100, lastAccess: 1_000 })
    const b = await craftStaged(db, dataDir, base, 9002, { bytes: 100, lastAccess: 2_000 })
    const c = await craftStaged(db, dataDir, base, 9003, { bytes: 100, lastAccess: 3_000 })

    // total 300, budget 150 → drop 9001 (→200), drop 9002 (→100 ≤ 150), stop.
    const outcome = await evictStagedOverBudget(db, dataDir, 150, NO_DRAGS)

    expect(outcome.evicted).toEqual([9001, 9002]) // LRU-first, in order
    expect(outcome.freedBytes).toBe(200)

    // audio AND sidecar gone together for the evicted pair — no orphans
    for (const p of [a, b]) {
      expect(existsSync(p.original)).toBe(false)
      expect(existsSync(p.sidecar)).toBe(false)
    }
    // the most-recently-used survivor keeps both files and its row
    expect(existsSync(c.original)).toBe(true)
    expect(existsSync(c.sidecar)).toBe(true)

    const rows = db
      .prepare('SELECT sound_id FROM staged_entries ORDER BY sound_id')
      .all() as { sound_id: number }[]
    expect(rows.map((r) => r.sound_id)).toEqual([9003])
  })

  it('is a no-op while total Staged bytes are within budget', async () => {
    const { core, dataDir, dbPath } = await signedInCore()
    const base = (await core.search('rain')).sounds.find((s) => s.id === RAIN_ID)!
    const db = openTemp(dbPath)
    const a = await craftStaged(db, dataDir, base, 9101, { bytes: 100 })

    const outcome = await evictStagedOverBudget(db, dataDir, DEFAULT_STAGING_BYTE_BUDGET, NO_DRAGS)

    expect(outcome.evicted).toEqual([])
    expect(existsSync(a.original)).toBe(true)
  })

  it('never removes a Sound that is in the Library', async () => {
    const { core, dataDir, dbPath } = await signedInCore()
    const base = (await core.search('rain')).sounds.find((s) => s.id === RAIN_ID)!
    const db = openTemp(dbPath)

    const kept = await craftStaged(db, dataDir, base, 9201, { bytes: 100, lastAccess: 1_000 })
    const staged = await craftStaged(db, dataDir, base, 9202, { bytes: 100, lastAccess: 2_000 })
    // 9201 is also a Library entry — it must be spared even though it is the LRU.
    db.prepare('INSERT INTO library_entries (sound_id, saved_at) VALUES (?, ?)').run(
      9201,
      Date.now(),
    )

    const outcome = await evictStagedOverBudget(db, dataDir, 0, NO_DRAGS)

    expect(outcome.skipped).toContain(9201)
    expect(outcome.evicted).toEqual([9202])
    expect(existsSync(kept.original)).toBe(true)
    expect(existsSync(kept.sidecar)).toBe(true)
    expect(existsSync(staged.original)).toBe(false)
  })

  it('never removes a file a live Drag-Out hardlink still needs', async () => {
    const { core, dataDir, dbPath } = await signedInCore()
    const base = (await core.search('rain')).sounds.find((s) => s.id === RAIN_ID)!
    const db = openTemp(dbPath)

    const dragging = await craftStaged(db, dataDir, base, 9301, { bytes: 100, lastAccess: 1_000 })
    const other = await craftStaged(db, dataDir, base, 9302, { bytes: 100, lastAccess: 2_000 })

    const inFlight = { has: (id: number) => id === 9301 }
    const outcome = await evictStagedOverBudget(db, dataDir, 0, inFlight)

    expect(outcome.skipped).toContain(9301)
    expect(outcome.evicted).toEqual([9302])
    expect(existsSync(dragging.original)).toBe(true)
    expect(existsSync(other.original)).toBe(false)
  })
})

// ─────────────── eviction through the live audition path ───────────────

describe('core.stageOnAudition — a stage over budget triggers LRU eviction', () => {
  it('exceeding the budget evicts the least-recently-used Staged sound, silently', async () => {
    const budget = bodyLen(RAIN_ID) + 5 // room for exactly one Original
    const { core, dataDir } = await signedInCore({ stagingByteBudget: budget })
    await core.search('rain')

    await stageReady(core, RAIN_ID)
    await stageReady(core, DRIZZLE_ID) // completing this trips eviction of RAIN

    // Eviction removes the Original then the sidecar in two awaited steps; wait
    // for BOTH so this poll can't win the race against the second unlink.
    await waitUntil(
      () =>
        !existsSync(join(dataDir, 'content', `${RAIN_ID}.wav`)) &&
        !existsSync(join(dataDir, 'content', `${RAIN_ID}.json`)),
    )
    expect(existsSync(join(dataDir, 'content', `${RAIN_ID}.json`))).toBe(false)
    expect(existsSync(join(dataDir, 'content', `${DRIZZLE_ID}.flac`))).toBe(true)
    expect(existsSync(join(dataDir, 'content', `${DRIZZLE_ID}.json`))).toBe(true)

    // The `staged_entries` row is dropped in the step right after the two file
    // unlinks, so poll for the status too rather than assume it lands together.
    await waitUntil(
      () => core.getStagingStatus([RAIN_ID])[RAIN_ID] === 'not-started',
    )
    expect(core.getStagingStatus([RAIN_ID])[RAIN_ID]).toBe('not-started')
  })

  it('spares a Sound with a live Drag-Out and evicts the next-oldest instead', async () => {
    // Budget fits two Originals but not three.
    const budget = bodyLen(RAIN_ID) + bodyLen(DRIZZLE_ID) + 5
    const host = createRecordingDragHost({ multiFileDragSupported: false })
    const { core, dataDir } = await signedInCore({
      stagingByteBudget: budget,
      dragHost: host,
    })
    await core.search('rain')

    await stageReady(core, RAIN_ID)
    await stageReady(core, DRIZZLE_ID) // still within budget — nothing evicted

    core.startDrag(RAIN_ID) // marks RAIN (the LRU) in-flight
    await stageReady(core, THUNDER_ID) // now over budget → eviction runs

    await waitUntil(
      () =>
        !existsSync(join(dataDir, 'content', `${DRIZZLE_ID}.flac`)) &&
        !existsSync(join(dataDir, 'content', `${DRIZZLE_ID}.json`)),
    )
    // RAIN survived despite being the LRU, because a drag still references it;
    // eviction took the next-oldest (DRIZZLE) instead.
    expect(existsSync(join(dataDir, 'content', `${RAIN_ID}.wav`))).toBe(true)
    expect(existsSync(join(dataDir, 'content', `${THUNDER_ID}.aiff`))).toBe(true)

    // once the drag ends, RAIN is evictable again
    core.endDrag(RAIN_ID)
    await stageReady(core, DRIZZLE_ID)
    await waitUntil(
      () =>
        !existsSync(join(dataDir, 'content', `${RAIN_ID}.wav`)) &&
        !existsSync(join(dataDir, 'content', `${RAIN_ID}.json`)),
    )
    // This case drives four real download+poll cycles and two eviction passes
    // through real timers/fs; under full-suite parallelism that can exceed the
    // 5s default. The assertions above still fail fast if the behaviour breaks.
  }, 20000)
})

// ───────────────────── getDiskUsage / clearStaged ─────────────────────

describe('core.getDiskUsage', () => {
  it('splits the on-disk footprint between Staged and Library bytes', async () => {
    const { core, dataDir, dbPath } = await signedInCore()
    await core.search('rain')
    await stageReady(core, RAIN_ID)
    await stageReady(core, DRIZZLE_ID)

    // "save" RAIN: give it a library_entries row and drop its staged row.
    const db = openTemp(dbPath)
    db.prepare('INSERT INTO library_entries (sound_id, saved_at) VALUES (?, ?)').run(
      RAIN_ID,
      Date.now(),
    )
    db.prepare('DELETE FROM staged_entries WHERE sound_id = ?').run(RAIN_ID)

    const usage = await core.getDiskUsage()
    expect(usage.staged).toBe(bodyLen(DRIZZLE_ID))
    expect(usage.library).toBe(statSync(join(dataDir, 'content', `${RAIN_ID}.wav`)).size)
    expect(usage.total).toBe(usage.staged + usage.library)
  })
})

describe('core.clearStaged', () => {
  it('removes every Staged Original + sidecar + row, leaving the Library untouched', async () => {
    const { core, dataDir, dbPath } = await signedInCore()
    await core.search('rain')
    await stageReady(core, RAIN_ID)
    await stageReady(core, DRIZZLE_ID)

    // "save" RAIN.
    const db = openTemp(dbPath)
    db.prepare('INSERT INTO library_entries (sound_id, saved_at) VALUES (?, ?)').run(
      RAIN_ID,
      Date.now(),
    )
    db.prepare('DELETE FROM staged_entries WHERE sound_id = ?').run(RAIN_ID)

    const outcome = await core.clearStaged()

    expect(outcome.evicted).toEqual([DRIZZLE_ID])

    // Staged material is gone — audio, sidecar and row
    expect(existsSync(join(dataDir, 'content', `${DRIZZLE_ID}.flac`))).toBe(false)
    expect(existsSync(join(dataDir, 'content', `${DRIZZLE_ID}.json`))).toBe(false)
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM staged_entries').get() as { n: number }).n,
    ).toBe(0)

    // Library sound is completely untouched — files and row both intact
    expect(existsSync(join(dataDir, 'content', `${RAIN_ID}.wav`))).toBe(true)
    expect(existsSync(join(dataDir, 'content', `${RAIN_ID}.json`))).toBe(true)
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM library_entries').get() as { n: number }).n,
    ).toBe(1)
  })

  it('skips a Sound with a live Drag-Out', async () => {
    const { core, dataDir, dbPath } = await signedInCore()
    const base = (await core.search('rain')).sounds.find((s) => s.id === RAIN_ID)!
    const db = openTemp(dbPath)
    const dragging = await craftStaged(db, dataDir, base, 9401, { bytes: 40 })
    const plain = await craftStaged(db, dataDir, base, 9402, { bytes: 40 })

    const outcome = await clearStagedStore(db, dataDir, {
      has: (id: number) => id === 9401,
    })

    expect(outcome.skipped).toEqual([9401])
    expect(outcome.evicted).toEqual([9402])
    expect(existsSync(dragging.original)).toBe(true)
    expect(existsSync(plain.original)).toBe(false)
  })
})

// ───────────────────────── disk-usage default ─────────────────────────

describe('computeDiskUsage', () => {
  it('reports zero for an untouched core', async () => {
    const { dataDir, dbPath } = await signedInCore()
    const db = openTemp(dbPath)
    expect(await computeDiskUsage(db, dataDir)).toEqual({
      staged: 0,
      library: 0,
      total: 0,
    })
  })
})
