import { randomBytes } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { DB } from '../db/index'
import { getSoundsByIds } from '../db/sounds'
import { getEditFieldsByIds } from '../db/edits'
import {
  deletePeaksRecord,
  getPeaksRecord,
  hasPeaksRecord,
  putPeaksRecord,
} from '../db/peaks'
import { contentPaths, isOriginalOnDisk } from '../staging/contentStore'
import { BASE_BUCKET_COUNT } from './computePeaks'
import type { PeakResult, TrimWindow } from './computeFromFile'
import type { PeakWorkerResponse } from './peakWorker'
import type { AudioRenderRunner } from '../edits/editService'

/** Containers `decodeAudioBuffer` reads directly — anything else needs a scratch PCM rendition. */
const LOCALLY_DECODABLE_TYPES = new Set(['wav', 'aiff'])

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
  /** Slice the decode to this window (seconds) first — an Edit computed from its parent's decode (ticket 03). */
  trim?: TrimWindow | null,
) => Promise<PeakResult>

export interface PeakServiceDeps {
  db: DB
  dataDir: string
  /** Absolute path to the built `peakWorker.js`. When set, computation runs on a real Worker thread. */
  peakWorkerPath?: string
  /** Test seam: replace the whole runner (in-process, or a controllable promise). Wins over `peakWorkerPath`. */
  runner?: PeakRunner
  /**
   * Ticket 03: when an Edit's parent is not a locally-decodable container, this
   * renders a scratch PCM rendition of the Edit's own file for the peak runner
   * to consume. The same seam `createEditService` uses for the export itself.
   */
  audioRenderRunner?: AudioRenderRunner
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
  return (filePath, targetBuckets, trim) =>
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
          workerData: { filePath, targetBuckets, trim },
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

  function applyResult(soundId: number, result: PeakResult): void {
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
      putPeaksRecord(db, {
        soundId,
        sampleRate: 0,
        bucketCount: 0,
        data: Buffer.alloc(0),
      })
      emit({ soundId, status: 'unavailable' })
    } else {
      emit({ soundId, status: 'unavailable' })
    }
  }

  /**
   * A regular Sound: peaks come off its own Original. WAV and AIFF decode
   * directly; any other container (FLAC, MP3, OGG…) is first rendered to a
   * throwaway PCM copy via `audioRenderRunner` — the same "decode anything"
   * detour `editTask` uses for a compressed-source Edit. Without a render
   * runner (tests, a stripped build) a non-decodable Original yields no peaks.
   */
  function soundTask(soundId: number): (() => Promise<PeakResult>) | null {
    const sound = getSoundsByIds(db, [soundId])[0]
    if (!sound || !isOriginalOnDisk(dataDir, sound)) {
      return null
    }
    const filePath = contentPaths(dataDir, sound).original
    if (LOCALLY_DECODABLE_TYPES.has(sound.type.toLowerCase())) {
      return () => runner!(filePath, BASE_BUCKET_COUNT)
    }
    if (!deps.audioRenderRunner) return null
    return () =>
      computeViaScratchPcm(filePath, {
        title: sound.name,
        author: sound.username,
        licenseUrl: sound.license.url,
      })
  }

  /**
   * An Edit: peaks ALWAYS come from the Edit's OWN rendered file, never a
   * slice of the parent's decode. A slice-from-parent shortcut looks
   * plausible but is wrong the moment the export actually changes the audio
   * — loudness-normalise, a format conversion, a resample/downmix — since the
   * parent's raw samples reflect none of that: the drawn waveform would
   * silently lie about what actually plays. Correctness over compute cost
   * (a sound-effect-length clip is cheap to decode either way).
   */
  function editTask(soundId: number): (() => Promise<PeakResult>) | null {
    const editSound = getSoundsByIds(db, [soundId])[0]
    const editFields = getEditFieldsByIds(db, [soundId]).get(soundId)
    if (!editSound || !editFields || !editFields.localPath) return null
    const { localPath } = editFields

    if (LOCALLY_DECODABLE_TYPES.has(editSound.type.toLowerCase())) {
      return () => runner!(localPath, BASE_BUCKET_COUNT)
    }

    if (!deps.audioRenderRunner) return null
    return () =>
      computeViaScratchPcm(localPath, {
        title: editSound.name,
        author: editSound.username,
        licenseUrl: editSound.license.url,
      })
  }

  /**
   * Render `sourcePath` (a content-store Original or an Edit's own file) to a
   * throwaway PCM `.wav`, compute peaks from that, then delete it. The scratch
   * file goes under the OS temp dir — never beside the source, so a stray copy
   * can never confuse the content store's LRU sweep or sidecar scan — and is
   * removed in a `finally` on every path.
   *
   * A render failure that ffmpeg reports as "this is not audio" comes back as
   * `undecodable: true` (a real dead end → the caller writes the sentinel). Any
   * other failure (ffmpeg missing, crash, disk full) stays `undecodable: false`
   * so a later `requestPeaks` retries instead of poisoning the cache.
   */
  async function computeViaScratchPcm(
    sourcePath: string,
    metadata: { title: string; author: string; licenseUrl: string },
  ): Promise<PeakResult> {
    const scratchPath = join(
      tmpdir(),
      `peaks-scratch-${randomBytes(8).toString('hex')}.wav`,
    )
    try {
      await deps.audioRenderRunner!({
        sourcePath,
        spec: { trim: null, format: 'wav' },
        outPath: scratchPath,
        signal: new AbortController().signal,
        metadata,
      })
      return await runner!(scratchPath, BASE_BUCKET_COUNT, null)
    } catch (err) {
      return { ok: false, undecodable: isNotAudioError(err), error: msg(err) }
    } finally {
      await rm(scratchPath, { force: true }).catch(() => {})
    }
  }

  function requestPeaks(soundId: number): void {
    if (hasPeaksRecord(db, soundId)) {
      announceCached(soundId)
      return
    }
    if (inFlight.has(soundId)) return

    if (!runner) {
      emit({ soundId, status: 'unavailable' })
      return
    }

    const compute = soundId < 0 ? editTask(soundId) : soundTask(soundId)
    if (!compute) {
      emit({ soundId, status: 'unavailable' })
      return
    }

    const task = compute()
      .then((result) => applyResult(soundId, result))
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

/**
 * Does this render failure mean the source genuinely is not decodable audio (a
 * dead end worth a sentinel), as opposed to a transient/environmental failure?
 * Keyed off the ffmpeg stderr tail the production runner attaches to its error.
 */
function isNotAudioError(err: unknown): boolean {
  const m = msg(err).toLowerCase()
  return (
    m.includes('invalid data found when processing input') ||
    m.includes('does not contain any stream') ||
    m.includes('could not find codec parameters')
  )
}
