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
import { computeViaScratchPcm, type ScratchPcmMetadata } from './scratchPcm'
import { workerRunner } from './workerRunner'
import type { PeakResult, PeakRunner } from './computeFromFile'
import type { Sound } from '../types'
import type { AudioRenderRunner } from '../edits/editService'

/** Containers `decodeAudioBuffer` reads directly — anything else needs a scratch PCM rendition. */
const LOCALLY_DECODABLE_TYPES = new Set(['wav', 'aiff'])

const INT16_MAX = 32767

/** Peaks as the renderer consumes them: min/max floats in [-1, 1], interleaved. */
export interface PeaksPayload {
  sampleRate: number
  bucketCount: number
  /** `[min0, max0, min1, max1, ...]`, length `bucketCount * 2`. */
  peaks: number[]
}

export type PeaksStatus = 'ready' | 'unavailable'

export interface PeaksStatusChange {
  soundId: number
  status: PeaksStatus
}

export interface PeakServiceDeps {
  db: DB
  dataDir: string
  /** Absolute path to the built `peakWorker.js`; when set, computation runs on a Worker thread. */
  peakWorkerPath?: string
  /** Test seam: replace the whole runner. Wins over `peakWorkerPath`. */
  runner?: PeakRunner
  /** Renders a scratch PCM rendition when the source container is not locally decodable. */
  audioRenderRunner?: AudioRenderRunner
  onStatusChange?: (change: PeaksStatusChange) => void
}

export interface PeakService {
  /** Cached peaks for a Sound, or `null` when there are none. Never computes. */
  getPeaks(soundId: number): PeaksPayload | null
  /**
   * Ensure peaks exist. Returns immediately; a cached result is announced
   * synchronously, otherwise a background computation is kicked off (deduped
   * per Sound) and its outcome announced when it finishes.
   */
  requestPeaks(soundId: number): void
  subscribe(listener: (change: PeaksStatusChange) => void): () => void
  /** Await the outcome for a Sound (used by tests). */
  whenSettled(soundId: number): Promise<void>
  close(): void
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
      return
    }
    if (result.undecodable) {
      putPeaksRecord(db, {
        soundId,
        sampleRate: 0,
        bucketCount: 0,
        data: Buffer.alloc(0),
      })
    }
    emit({ soundId, status: 'unavailable' })
  }

  function metadataOf(sound: Sound): ScratchPcmMetadata {
    return {
      title: sound.name,
      author: sound.username,
      licenseUrl: sound.license.url,
    }
  }

  /**
   * Peaks for `sound` from `filePath`. WAV and AIFF decode directly; anything
   * else detours through a throwaway PCM copy, and yields no peaks at all
   * without a render runner.
   */
  function taskFor(
    sound: Sound,
    filePath: string,
  ): (() => Promise<PeakResult>) | null {
    if (LOCALLY_DECODABLE_TYPES.has(sound.type.toLowerCase())) {
      return () => runner!(filePath, BASE_BUCKET_COUNT)
    }
    const render = deps.audioRenderRunner
    if (!render) return null
    return () =>
      computeViaScratchPcm({
        sourcePath: filePath,
        metadata: metadataOf(sound),
        render,
        runner: runner!,
      })
  }

  function soundTask(soundId: number): (() => Promise<PeakResult>) | null {
    const sound = getSoundsByIds(db, [soundId])[0]
    if (!sound || !isOriginalOnDisk(dataDir, sound)) return null
    return taskFor(sound, contentPaths(dataDir, sound).original)
  }

  /**
   * An Edit's peaks always come from the Edit's OWN rendered file, never a slice
   * of the parent's decode: normalise, format conversion and resample/downmix
   * all change the samples, so a slice-from-parent waveform would lie about what
   * actually plays.
   */
  function editTask(soundId: number): (() => Promise<PeakResult>) | null {
    const sound = getSoundsByIds(db, [soundId])[0]
    const localPath = getEditFieldsByIds(db, [soundId]).get(soundId)?.localPath
    if (!sound || !localPath) return null
    return taskFor(sound, localPath)
  }

  function requestPeaks(soundId: number): void {
    if (hasPeaksRecord(db, soundId)) {
      announceCached(soundId)
      return
    }
    if (inFlight.has(soundId)) return

    const compute = runner
      ? soundId < 0
        ? editTask(soundId)
        : soundTask(soundId)
      : null
    if (!compute) {
      emit({ soundId, status: 'unavailable' })
      return
    }

    const task = compute()
      .then((result) => applyResult(soundId, result))
      .catch(() => emit({ soundId, status: 'unavailable' }))
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

export { workerRunner } from './workerRunner'
export type { PeakRunner } from './computeFromFile'
export { deletePeaksRecord }
