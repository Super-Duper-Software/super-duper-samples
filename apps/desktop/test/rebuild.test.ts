// Ticket 14 — rebuild the Library from sidecars, at the core seam. No Electron:
// real temp SQLite, real temp filesystem, the fake gateway. The content-store
// scan is exercised for real once on a `node:worker_threads` thread
// (`rebuildWorkerRunner` + an inline worker); every other case runs the scan
// in-process so timing is deterministic.
//
// Covers the ticket's "Tests cover:" line:
//   - deleting the database and rebuilding reconstructs the Library from sidecars
//   - orphan audio (no sidecar) is reported rather than dropped or imported
//   - orphan sidecars (no audio) are reported and cleaned up
//   - one malformed sidecar does not abort the whole rebuild
//   - rebuilt entries carry the correct author and License
// plus: a missing / unreadable / half-migrated database is detected on startup;
// the "custom names, custom tags and Collections are not recoverable" line is
// present before and after; the rebuild scan runs off the calling thread and
// reports progress.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { assessStartup, inspectDbHealth } from '../src/core'
import {
  NOT_RECOVERABLE_MESSAGE,
  rebuildWorkerRunner,
  scanSidecars,
  type RebuildRunner,
  type SidecarScan,
} from '../src/core/rebuild/rebuildService'
import { writeOriginal } from '../src/core/staging/contentStore'
import type { Sound } from '../src/core/types'
import { makeTestCore } from './helpers/makeTestCore'

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

const FIXED_NOW = 1_700_000_000_000

function fakeSound(id: number, over: Partial<Sound> = {}): Sound {
  return {
    id,
    name: `sound ${id}`,
    username: `author_${id}`,
    license: {
      url: 'http://creativecommons.org/publicdomain/zero/1.0/',
      name: 'CC0',
    },
    duration: 3,
    tags: ['test'],
    filesize: 5,
    type: 'wav',
    samplerate: 44100,
    channels: 2,
    bitdepth: 16,
    previewUrls: { hqMp3: 'hq.mp3', lqMp3: 'lq.mp3', hqOgg: '', lqOgg: '' },
    waveformUrls: { m: 'm.png', l: 'l.png' },
    url: `https://freesound.org/s/${id}/`,
    downloadCount: 0,
    avgRating: 0,
    created: '2020-01-01T00:00:00Z',
    ...over,
  }
}

/** Write a complete Original + sidecar pair into `<dataDir>/content/`. */
async function writePair(
  dataDir: string,
  sound: Sound,
  bytes = `ORIGINAL:${sound.id}`,
): Promise<void> {
  await writeOriginal(dataDir, sound, new TextEncoder().encode(bytes), FIXED_NOW)
}

function contentPath(dataDir: string, name: string): string {
  return join(dataDir, 'content', name)
}

// ───────────────────── the read-only scan (scanSidecars) ─────────────────────

describe('scanSidecars — pairs Originals with sidecars and classifies the rest', () => {
  it('separates recovered pairs, orphan audio, orphan sidecars and malformed', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rebuild-scan-'))
    cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }))

    // Two clean pairs.
    await writePair(dataDir, fakeSound(1))
    await writePair(dataDir, fakeSound(2))
    // Orphan sidecar: pair then delete the audio.
    await writePair(dataDir, fakeSound(3))
    rmSync(contentPath(dataDir, '3.wav'))
    // Orphan audio: an Original with no sidecar at all.
    writeFileSync(contentPath(dataDir, '99.wav'), 'loose bytes')
    // Malformed sidecar (with its audio present).
    writeFileSync(contentPath(dataDir, '77.wav'), 'x')
    writeFileSync(contentPath(dataDir, '77.json'), '{ not valid json')
    // A half-written temp file must be ignored entirely.
    writeFileSync(contentPath(dataDir, '5.wav.abc123.part'), 'partial')

    const scan = await scanSidecars(contentPath(dataDir, '').replace(/\/$/, ''))

    expect(scan.recovered.map((r) => r.soundId).sort()).toEqual([1, 2])
    expect(scan.orphanAudio).toEqual(['99.wav'])
    expect(scan.orphanSidecars).toEqual([contentPath(dataDir, '3.json')])
    expect(scan.malformed).toHaveLength(1)
    expect(scan.malformed[0]!.file).toBe('77.json')
    // 77.wav has a sidecar (malformed) — it must NOT also be counted as orphan audio.
    expect(scan.orphanAudio).not.toContain('77.wav')
  })

  it('a missing content directory yields an all-empty scan (a fresh install)', async () => {
    const scan = await scanSidecars(join(tmpdir(), 'does-not-exist-' + Date.now()))
    expect(scan).toEqual({
      recovered: [],
      orphanAudio: [],
      orphanSidecars: [],
      malformed: [],
      total: 0,
    })
  })
})

// ─────────────────── rebuild reconstructs the Library ───────────────────

describe('core.rebuildFromSidecars — reconstructs the Library from disk', () => {
  it('rebuilds Library membership and metadata with author + License intact', async () => {
    const tc = await makeTestCore()
    cleanups.push(() => tc.core.close())

    await writePair(
      tc.dataDir,
      fakeSound(101, {
        name: 'Distant thunder',
        username: 'fieldrecorder',
        license: {
          url: 'http://creativecommons.org/licenses/by/4.0/',
          name: 'CC-BY',
        },
      }),
    )
    await writePair(
      tc.dataDir,
      fakeSound(202, { name: 'Creek', username: 'hydrophile' }),
    )

    // The database is empty — exactly as if it had been deleted.
    expect(tc.core.listLibrary()).toEqual([])

    const report = await tc.core.rebuildFromSidecars()

    expect(report.counts.recovered).toBe(2)
    const byId = new Map(report.recovered.map((r) => [r.soundId, r]))
    expect(byId.get(101)).toMatchObject({
      author: 'fieldrecorder',
      license: 'CC-BY',
      name: 'Distant thunder',
    })
    expect(byId.get(202)).toMatchObject({ author: 'hydrophile', license: 'CC0' })

    const lib = tc.core.listLibrary()
    expect(lib.map((s) => s.id).sort()).toEqual([101, 202])
    const thunder = lib.find((s) => s.id === 101)!
    expect(thunder.username).toBe('fieldrecorder')
    expect(thunder.license).toEqual({
      url: 'http://creativecommons.org/licenses/by/4.0/',
      name: 'CC-BY',
    })
    // Browsable + auditionable + draggable: the Original is on disk and resolvable.
    expect(tc.core.getContentPath(101)).toBe(contentPath(tc.dataDir, '101.wav'))
    expect(tc.core.getFreesoundUrl(202)).toBe('https://freesound.org/s/202/')
  })

  it('survives a real database deletion + restart', async () => {
    const tc1 = await makeTestCore()
    await writePair(tc1.dataDir, fakeSound(11))
    await writePair(tc1.dataDir, fakeSound(22))
    tc1.core.saveToLibrary(11, fakeSound(11))
    tc1.core.saveToLibrary(22, fakeSound(22))
    expect(tc1.core.listLibrary()).toHaveLength(2)
    tc1.core.close()

    // Nuke the database entirely (main file + WAL sidecars).
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(tc1.dbPath + suffix, { force: true })
    }

    const assessment = assessStartup({
      dbPath: tc1.dbPath,
      dataDir: tc1.dataDir,
    })
    expect(assessment.db).toEqual({ ok: false, reason: 'missing' })
    expect(assessment.sidecarCount).toBe(2)
    expect(assessment.offerRebuild).toBe(true)
    expect(assessment.notRecoverable).toBe(NOT_RECOVERABLE_MESSAGE)

    // Restart on the same data dir + (now absent) db path.
    const tc2 = await makeTestCore({
      dbPath: tc1.dbPath,
      dataDir: tc1.dataDir,
    })
    cleanups.push(() => tc2.core.close())
    expect(tc2.core.getStartupAssessment().offerRebuild).toBe(true)
    expect(tc2.core.listLibrary()).toEqual([]) // schema recreated, but empty

    const report = await tc2.core.rebuildFromSidecars()
    expect(report.counts.recovered).toBe(2)
    expect(tc2.core.listLibrary().map((s) => s.id).sort()).toEqual([11, 22])
  })

  it('re-running is safe: an already-present Sound is left as it is', async () => {
    const tc = await makeTestCore()
    cleanups.push(() => tc.core.close())
    await writePair(tc.dataDir, fakeSound(1))

    await tc.core.rebuildFromSidecars()
    const second = await tc.core.rebuildFromSidecars()
    expect(second.counts.recovered).toBe(1)
    expect(second.counts.alreadyPresent).toBe(1)
    expect(tc.core.listLibrary()).toHaveLength(1)
  })
})

// ─────────────────── orphans and malformed sidecars ───────────────────

describe('core.rebuildFromSidecars — orphans and malformed', () => {
  it('reports orphan audio without dropping it or importing it', async () => {
    const tc = await makeTestCore()
    cleanups.push(() => tc.core.close())

    await writePair(tc.dataDir, fakeSound(1))
    writeFileSync(contentPath(tc.dataDir, '5150.wav'), 'no sidecar here')

    const report = await tc.core.rebuildFromSidecars()

    expect(report.orphanAudio).toEqual(['5150.wav'])
    expect(report.counts.orphanAudio).toBe(1)
    // Left on disk, untouched.
    expect(existsSync(contentPath(tc.dataDir, '5150.wav'))).toBe(true)
    // NOT imported into the Library (no attribution → no membership).
    expect(tc.core.listLibrary().map((s) => s.id)).toEqual([1])
  })

  it('reports an orphan sidecar and removes its .json', async () => {
    const tc = await makeTestCore()
    cleanups.push(() => tc.core.close())

    await writePair(tc.dataDir, fakeSound(1))
    await writePair(tc.dataDir, fakeSound(404))
    rmSync(contentPath(tc.dataDir, '404.wav')) // audio gone, sidecar stays

    const report = await tc.core.rebuildFromSidecars()

    const orphanJson = contentPath(tc.dataDir, '404.json')
    expect(report.orphanSidecars).toEqual([orphanJson])
    expect(report.cleanedUpSidecars).toEqual([orphanJson])
    expect(existsSync(orphanJson)).toBe(false)
    expect(tc.core.listLibrary().map((s) => s.id)).toEqual([1])
  })

  it('one malformed sidecar does not abort the rebuild', async () => {
    const tc = await makeTestCore()
    cleanups.push(() => tc.core.close())

    await writePair(tc.dataDir, fakeSound(1))
    await writePair(tc.dataDir, fakeSound(2))
    // Corrupt one sidecar in place; its Original stays on disk.
    writeFileSync(contentPath(tc.dataDir, '2.json'), '{ "soundId": 2, oops')
    // A structurally-valid JSON that is missing the author.
    writeFileSync(contentPath(tc.dataDir, '3.wav'), 'x')
    writeFileSync(
      contentPath(tc.dataDir, '3.json'),
      JSON.stringify({ soundId: 3, sound: { id: 3, name: 'x' } }),
    )

    const report = await tc.core.rebuildFromSidecars()

    expect(report.counts.recovered).toBe(1)
    expect(tc.core.listLibrary().map((s) => s.id)).toEqual([1])
    expect(report.malformed.map((m) => m.file).sort()).toEqual([
      '2.json',
      '3.json',
    ])
    expect(report.malformed.find((m) => m.file === '3.json')!.error).toMatch(
      /author/i,
    )
  })
})

// ─────────────────── startup detection + user-facing honesty ───────────────────

describe('startup detection of a missing / unreadable / half-migrated database', () => {
  it('inspectDbHealth flags an unreadable file and a schema-less file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-health-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))

    expect(inspectDbHealth(join(dir, 'nope.db'))).toEqual({
      ok: false,
      reason: 'missing',
    })

    const garbage = join(dir, 'garbage.db')
    writeFileSync(garbage, 'this is definitely not a sqlite file')
    expect(inspectDbHealth(garbage)).toEqual({
      ok: false,
      reason: 'unreadable',
    })

    const empty = join(dir, 'empty.db')
    new Database(empty).close() // a valid but table-less database
    expect(inspectDbHealth(empty)).toEqual({
      ok: false,
      reason: 'schema-incomplete',
    })
  })

  it('offers a rebuild only when the DB is unusable AND sidecars exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-offer-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const dbPath = join(dir, 'library.db')

    // Missing DB, no sidecars → this is just a first run.
    expect(assessStartup({ dbPath, dataDir: dir }).offerRebuild).toBe(false)

    // Add a corrupt DB + a sidecar → now a rebuild is worth offering.
    writeFileSync(dbPath, 'corrupt')
    await writePair(dir, fakeSound(1))
    const a = assessStartup({ dbPath, dataDir: dir })
    expect(a.db).toEqual({ ok: false, reason: 'unreadable' })
    expect(a.sidecarCount).toBe(1)
    expect(a.offerRebuild).toBe(true)
  })

  it('states plainly — before and after — what a rebuild cannot recover', async () => {
    const tc = await makeTestCore()
    cleanups.push(() => tc.core.close())
    await writePair(tc.dataDir, fakeSound(1))

    // Before: carried on the startup assessment the renderer shows in the offer.
    expect(tc.core.getStartupAssessment().notRecoverable).toMatch(
      /custom names.*custom tags.*Collections/i,
    )
    // After: carried on the result.
    const report = await tc.core.rebuildFromSidecars()
    expect(report.notRecoverable).toBe(NOT_RECOVERABLE_MESSAGE)
    expect(report.notRecoverable).toMatch(/Collections/)
  })
})

// ─────────────────── off-thread + progress ───────────────────

describe('core.rebuildFromSidecars — runs off the calling thread, reports progress', () => {
  it('does not block: other commands stay responsive while the scan is pending', async () => {
    let release!: (scan: SidecarScan) => void
    const gate = new Promise<SidecarScan>((r) => {
      release = r
    })
    const runner: RebuildRunner = (_dir, onProgress) => {
      onProgress({ done: 0, total: 3 })
      return gate
    }
    const tc = await makeTestCore({ rebuildRunner: runner })
    cleanups.push(() => tc.core.close())

    const pending = tc.core.rebuildFromSidecars()
    let settled = false
    void pending.then(() => {
      settled = true
    })

    // The scan is still in flight, yet the core answers other commands at once.
    expect(settled).toBe(false)
    expect(tc.core.listLibrary()).toEqual([])
    expect(tc.core.getStartupAssessment()).toBeDefined()

    release({
      recovered: [],
      orphanAudio: [],
      orphanSidecars: [],
      malformed: [],
      total: 3,
    })
    const report = await pending
    expect(report.counts.recovered).toBe(0)
  })

  it('emits { done, total } progress through subscribeRebuildProgress', async () => {
    const tc = await makeTestCore()
    cleanups.push(() => tc.core.close())
    await writePair(tc.dataDir, fakeSound(1))
    await writePair(tc.dataDir, fakeSound(2))
    await writePair(tc.dataDir, fakeSound(3))

    const seen: Array<{ done: number; total: number }> = []
    const off = tc.core.subscribeRebuildProgress((p) => seen.push(p))
    await tc.core.rebuildFromSidecars()
    off()

    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]).toEqual({ done: 0, total: 3 })
    expect(seen.at(-1)).toEqual({ done: 3, total: 3 })
  })

  it('the real scan runs on a worker_threads thread via rebuildWorkerRunner', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-worker-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const workerJs = join(dir, 'worker.mjs')
    writeFileSync(
      workerJs,
      `
      import { parentPort, workerData, threadId } from 'node:worker_threads'
      if (threadId < 1) {
        parentPort.postMessage({ type: 'error', error: 'ran on the main thread' })
      } else {
        parentPort.postMessage({ type: 'progress', done: 1, total: 2 })
        parentPort.postMessage({ type: 'progress', done: 2, total: 2 })
        parentPort.postMessage({
          type: 'done',
          scan: {
            recovered: [],
            orphanAudio: [workerData.contentDir],
            orphanSidecars: [],
            malformed: [],
            total: 2,
          },
        })
      }
      `,
      'utf8',
    )

    const run = rebuildWorkerRunner(workerJs)
    const progress: Array<{ done: number; total: number }> = []
    const scan = await run('/some/content/dir', (p) => progress.push(p))

    expect(scan.total).toBe(2)
    expect(scan.orphanAudio).toEqual(['/some/content/dir'])
    expect(progress).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ])
  })
})
