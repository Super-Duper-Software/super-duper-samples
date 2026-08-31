// "Rebuild from sidecars" (ticket 14) — the safety net ADR-0002 promises in
// exchange for making SQLite authoritative. If the database is lost, this
// reconstructs the `sounds` rows and `library_entries` from the content store's
// `<id>.json` sidecars alone.
//
// What it does NOT recover, and says so plainly (`NOT_RECOVERABLE_MESSAGE`):
// custom names, custom tags and Collections live only in the database.
//
// Shape:
//   - the read-only scan (`scanSidecars`) runs OFF this thread in production (a
//     `node:worker_threads` Worker; `src/main` passes `rebuildWorkerPath`), so a
//     large library never blocks the main process. It emits `{ done, total }`
//     progress. Tests inject `runner` — in-process, or a controllable promise to
//     prove the core call does not block.
//   - the DB writes and orphan-sidecar cleanup happen back on this thread, in
//     one transaction, from the scan's result.

import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import type { DB } from '../db/index'
import { upsertSound } from '../db/sounds'
import { saveLibraryEntry, hasLibraryEntry } from '../db/library'
import { CONTENT_DIRNAME } from '../staging/contentStore'
import {
  scanSidecars,
  type ScanProgress,
  type ScannedSidecar,
  type SidecarScan,
  type MalformedSidecar,
} from './scanSidecars'

export {
  scanSidecars,
  type SidecarScan,
  type ScannedSidecar,
  type MalformedSidecar,
} from './scanSidecars'

/** Progress of the (off-thread) sidecar scan. */
export type RebuildProgress = ScanProgress

/**
 * The read-only scan step, made injectable. Production wraps a Worker thread;
 * tests pass an in-process function (optionally behind a controllable promise).
 */
export type RebuildRunner = (
  contentDir: string,
  onProgress: (p: RebuildProgress) => void,
) => Promise<SidecarScan>

/** One Library Sound brought back by a rebuild. */
export interface RebuildRecovered {
  soundId: number
  /** The Freesound name (custom names are NOT recoverable). */
  name: string
  /** Uploading author's Freesound username. */
  author: string
  /** Short License label, e.g. `CC-BY`, `CC0`. */
  license: string
  /** Basename of the Original on disk. */
  audioFile: string
}

/** What a rebuild recovered and what it could not. Handed to the renderer verbatim. */
export interface RebuildReport {
  /** Sounds re-added to the Library, each with author + License intact. */
  recovered: RebuildRecovered[]
  /** Originals with no sidecar — reported for manual attribution, left on disk. */
  orphanAudio: string[]
  /** Sidecars whose Original was gone — reported, and their `.json` removed. */
  orphanSidecars: string[]
  /** Sidecars that failed individually; the rest of the rebuild still ran. */
  malformed: MalformedSidecar[]
  /** Orphan `.json` files actually deleted (subset of `orphanSidecars`). */
  cleanedUpSidecars: string[]
  /** Plain-language: what a rebuild can never bring back. Always set. */
  notRecoverable: string
  counts: {
    recovered: number
    /** Of `recovered`, how many already had a Library row (rebuild re-run). */
    alreadyPresent: number
    orphanAudio: number
    orphanSidecars: number
    malformed: number
  }
}

/**
 * The one honest sentence the renderer shows both in the rebuild offer and in
 * the result. Rebuild cannot see the database, and these three live only there.
 */
export const NOT_RECOVERABLE_MESSAGE =
  'Custom names, custom tags and Collections are stored only in the database and cannot be recovered by a rebuild.'

export interface RebuildServiceDeps {
  db: DB
  /** App data directory; sidecars live in `<dataDir>/content/`. */
  dataDir: string
  /** Absolute path to the built `rebuildWorker.js`. When set, the scan runs on a Worker thread. */
  rebuildWorkerPath?: string
  /** Test seam: replace the scan runner entirely. Wins over `rebuildWorkerPath`. */
  runner?: RebuildRunner
  /** Announce scan progress (main forwards it to the renderer). */
  onProgress?: (p: RebuildProgress) => void
}

export interface RebuildService {
  /**
   * Scan the content store and reconstruct the Library from its sidecars.
   * Returns a structured report of everything recovered and everything that
   * could not be. Safe to re-run: an already-present Sound is left as it is.
   */
  rebuildFromSidecars(): Promise<RebuildReport>
  /** Subscribe to scan-progress updates. Returns an unsubscribe function. */
  subscribe(listener: (p: RebuildProgress) => void): () => void
  close(): void
}

/** The real runner: spawn a one-shot Worker for the scan and await its result. */
export function rebuildWorkerRunner(workerPath: string): RebuildRunner {
  return (contentDir, onProgress) =>
    new Promise<SidecarScan>((resolve, reject) => {
      let settled = false
      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        fn()
      }
      let worker: Worker
      try {
        worker = new Worker(workerPath, { workerData: { contentDir } })
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
        return
      }
      worker.on('message', (m: RebuildWorkerMessage) => {
        if (m.type === 'progress') {
          onProgress({ done: m.done, total: m.total })
        } else if (m.type === 'done') {
          finish(() => resolve(m.scan))
          void worker.terminate()
        } else {
          finish(() => reject(new Error(m.error)))
          void worker.terminate()
        }
      })
      worker.once('error', (err) => {
        finish(() => reject(err))
        void worker.terminate()
      })
      worker.once('exit', () =>
        finish(() => reject(new Error('rebuild worker exited without a result'))),
      )
    })
}

/** Messages the rebuild Worker posts back. */
export type RebuildWorkerMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; scan: SidecarScan }
  | { type: 'error'; error: string }

export function createRebuildService(deps: RebuildServiceDeps): RebuildService {
  const { db, dataDir } = deps
  const listeners = new Set<(p: RebuildProgress) => void>()

  const runner: RebuildRunner =
    deps.runner ??
    (deps.rebuildWorkerPath
      ? rebuildWorkerRunner(deps.rebuildWorkerPath)
      : scanSidecars)

  function emit(p: RebuildProgress): void {
    for (const l of listeners) l(p)
    deps.onProgress?.(p)
  }

  async function rebuildFromSidecars(): Promise<RebuildReport> {
    const contentDir = join(dataDir, CONTENT_DIRNAME)
    const scan = await runner(contentDir, emit)

    let alreadyPresent = 0
    const recovered: RebuildRecovered[] = []

    const apply = db.transaction((items: ScannedSidecar[]) => {
      for (const item of items) {
        if (hasLibraryEntry(db, item.soundId)) alreadyPresent += 1
        upsertSound(db, item.sidecar.sound)
        // `saveLibraryEntry` is INSERT ... ON CONFLICT DO NOTHING, so a re-run
        // never moves an existing `saved_at`. Use the sidecar's download time as
        // the best available "saved at".
        saveLibraryEntry(
          db,
          item.soundId,
          item.sidecar.downloadedAt || Date.now(),
        )
        recovered.push({
          soundId: item.soundId,
          name: item.sidecar.sound.name,
          author: item.sidecar.sound.username,
          license: item.sidecar.sound.license.name,
          audioFile: item.audioName,
        })
      }
    })
    apply(scan.recovered)

    // Orphan sidecars have no Original to belong to — report AND remove the .json.
    const cleanedUpSidecars: string[] = []
    for (const p of scan.orphanSidecars) {
      try {
        await rm(p, { force: true })
        cleanedUpSidecars.push(p)
      } catch {
        // Leave it; it is still reported in `orphanSidecars`.
      }
    }

    return {
      recovered,
      orphanAudio: scan.orphanAudio,
      orphanSidecars: scan.orphanSidecars,
      malformed: scan.malformed,
      cleanedUpSidecars,
      notRecoverable: NOT_RECOVERABLE_MESSAGE,
      counts: {
        recovered: recovered.length,
        alreadyPresent,
        orphanAudio: scan.orphanAudio.length,
        orphanSidecars: scan.orphanSidecars.length,
        malformed: scan.malformed.length,
      },
    }
  }

  return {
    rebuildFromSidecars,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      listeners.clear()
    },
  }
}
