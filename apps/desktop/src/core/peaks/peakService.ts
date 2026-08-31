// Peak computation orchestration (ticket 12).
//
// Responsibilities:
//   - answer `getPeaks(soundId)` from the SQLite cache (decode the Int16 BLOB to
//     floats the renderer can draw), instantly on any revisit;
//   - on `requestPeaks(soundId)`, if there are no cached peaks and the Original
//     is on disk, run the decode + envelope sweep OFF this thread (a
//     `node:worker_threads` Worker in production) and cache the result;
//   - never block the caller: `requestPeaks` returns synchronously and the work
//     completes later, announced via `onStatusChange`;
//   - compute at most once per Sound — an undecodable Original is remembered as a
//     sentinel row so it is not re-attempted every visit.
//
// The runner is injectable (`PeakRunner`), so tests drive computation in-process
// (synchronously, or via a controllable promise to prove non-blocking) without
// spawning a real thread.

import { Worker } from 'node:worker_threads'
import type { DB } from '../db/index'
import { getSoundsByIds } from '../db/sounds'
import {
  deletePeaksRecord,
  getPeaksRecord,
  hasPeaksRecord,
  putPeaksRecord,
} from '../db/peaks'
import { contentPaths, isOriginalOnDisk } from '../staging/contentStore'
import { BASE_BUCKET_COUNT } from './computePeaks'
import type { PeakResult } from './computeFromFile'
import type { PeakWorkerResponse } from './peakWorker'

/** Peaks as the renderer consumes them: min/max floats in [-1, 1], interleaved. */
export interface PeaksPayload {
  sampleRate: number
  bucketCount: number
  /** `[min0, max0, min1, max1, ...]`, length `bucketCount * 2`, each in [-1, 1]. */
  peaks: number[]
}

export type PeaksStatus = 'ready' | 'unavailable'

export interface PeaksStatusChange {
  soundId: number
  /** `ready` — cached peaks now exist; `unavailable` — no peaks (undecodable, or Original not on disk). */
  status: PeaksStatus
}

/**
 * Runs one computation for a file. Resolves with the envelope or a typed failure;
 * it never throws for an undecodable Original (that is `{ ok: false, undecodable
 * }`). Production uses `workerRunner`; tests inject their own.
 */
export type PeakRunner = (
  filePath: string,
  targetBuckets: number,
) => Promise<PeakResult>

export interface PeakServiceDeps {
  db: DB
  dataDir: string
  /** Absolute path to the built `peakWorker.js`. When set, computation runs on a real Worker thread. */
  peakWorkerPath?: string
  /** Test seam: replace the whole runner (in-process, or a controllable promise). Wins over `peakWorkerPath`. */
  runner?: PeakRunner
  /** Announce every transition (main forwards it to the renderer). */
  onStatusChange?: (change: PeaksStatusChange) => void
}

export interface PeakService {
  /** Cached peaks for a Sound, or `null` when there are none (never computes). */
  getPeaks(soundId: number): PeaksPayload | null
  /**
   * Ensure peaks exist for a Sound. Returns immediately. If they are cached, the
   * status is announced synchronously; otherwise a background computation is
   * kicked off (deduped per Sound) and its outcome announced when it finishes.
   */
  requestPeaks(soundId: number): void
  /** Subscribe to status transitions. Returns an unsubscribe function. */
  subscribe(listener: (change: PeaksStatusChange) => void): () => void
  /** Await the outcome for a Sound (used by tests). */
  whenSettled(soundId: number): Promise<void>
  close(): void
}

const INT16_MAX = 32767

/** The real runner: spawn a one-shot Worker thread and await its single message. */
export function workerRunner(workerPath: string): PeakRunner {
  return (filePath, targetBuckets) =>
    new Promise<PeakResult>((resolve) => {
      let settled = false
      const done = (r: PeakResult): void => {
        if (settled) return
        settled = true
        resolve(r)
      }
      let worker: Worker
      try {
        worker = new Worker(workerPath, {
          workerData: { filePath, targetBuckets },
        })
      } catch (err) {
        done({ ok: false, undecodable: false, error: msg(err) })
        return
      }
      worker.once('message', (m: PeakWorkerResponse) => {
        if (m.ok) {
          const int16 = new Int16Array(m.data)
          done({
            ok: true,
            value: {
              sampleRate: m.sampleRate,
              bucketCount: m.bucketCount,
              data: int16,
            },
          })
        } else {
          done({ ok: false, undecodable: m.undecodable, error: m.error })
        }
        void worker.terminate()
      })
      worker.once('error', (err) => {
        done({ ok: false, undecodable: false, error: msg(err) })
        void worker.terminate()
      })
      worker.once('exit', () =>
        done({
          ok: false,
          undecodable: false,
          error: 'worker exited without a result',
        }),
      )
    })
}

export function createPeakService(deps: PeakServiceDeps): PeakService {
  const { db, dataDir } = deps
  const listeners = new Set<(c: PeaksStatusChange) => void>()
  const inFlight = new Map<number, Promise<void>>()

  // Computation only happens OFF this thread. In production `src/main` passes
  // `peakWorkerPath`; tests inject `runner` (in-process, or a controllable
  // promise). With neither, the service still serves the cache but never
  // computes — it will not silently fall back to blocking work on this thread.
  const runner: PeakRunner | null =
    deps.runner ??
    (deps.peakWorkerPath ? workerRunner(deps.peakWorkerPath) : null)

  function emit(change: PeaksStatusChange): void {
    for (const l of listeners) l(change)
    deps.onStatusChange?.(change)
  }

  function getPeaks(soundId: number): PeaksPayload | null {
    const rec = getPeaksRecord(db, soundId)
    if (!rec || rec.bucketCount === 0) return null
    // Read Int16LE pairs straight off the Buffer — no alignment assumptions about
    // where SQLite / Node placed the bytes.
    const count = rec.data.byteLength >> 1
    const peaks = new Array<number>(count)
    for (let i = 0; i < count; i++) {
      peaks[i] = rec.data.readInt16LE(i * 2) / INT16_MAX
    }
    return { sampleRate: rec.sampleRate, bucketCount: rec.bucketCount, peaks }
  }

  function announceCached(soundId: number): void {
    const rec = getPeaksRecord(db, soundId)
    emit({
      soundId,
      status: rec && rec.bucketCount > 0 ? 'ready' : 'unavailable',
    })
  }

  function requestPeaks(soundId: number): void {
    if (hasPeaksRecord(db, soundId)) {
      announceCached(soundId)
      return
    }
    if (inFlight.has(soundId)) return

    if (!runner) {
      // No off-thread compute path configured — never block this thread.
      emit({ soundId, status: 'unavailable' })
      return
    }

    const sound = getSoundsByIds(db, [soundId])[0]
    if (!sound || !isOriginalOnDisk(dataDir, sound)) {
      // Original not here (yet). Don't cache anything — a later download can
      // trigger `requestPeaks` again.
      emit({ soundId, status: 'unavailable' })
      return
    }

    const filePath = contentPaths(dataDir, sound).original
    const task = runner(filePath, BASE_BUCKET_COUNT)
      .then((result) => {
        if (result.ok) {
          putPeaksRecord(db, {
            soundId,
            sampleRate: result.value.sampleRate,
            bucketCount: result.value.bucketCount,
            data: Buffer.from(
              result.value.data.buffer,
              result.value.data.byteOffset,
              result.value.data.byteLength,
            ),
          })
          emit({ soundId, status: 'ready' })
        } else if (result.undecodable) {
          // Sentinel: remember "cannot decode" so we never try this Original again.
          putPeaksRecord(db, {
            soundId,
            sampleRate: 0,
            bucketCount: 0,
            data: Buffer.alloc(0),
          })
          emit({ soundId, status: 'unavailable' })
        } else {
          // Transient (file vanished mid-read, worker crash): leave the cache
          // empty so a later request retries.
          emit({ soundId, status: 'unavailable' })
        }
      })
      .catch(() => {
        emit({ soundId, status: 'unavailable' })
      })
      .finally(() => {
        inFlight.delete(soundId)
      })
    inFlight.set(soundId, task)
  }

  return {
    getPeaks,
    requestPeaks,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    whenSettled(soundId) {
      return inFlight.get(soundId) ?? Promise.resolve()
    },
    close() {
      listeners.clear()
    },
  }
}

/** Test/maintenance helper mirroring the other db modules' re-exports. */
export { deletePeaksRecord }

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
