// Read an Original off disk and reduce it to a peak envelope (ticket 12). This is
// the unit of work that runs inside the peak Worker — it touches the filesystem
// and does the CPU-heavy sweep, but never SQLite and never Electron.

import { readFile } from 'node:fs/promises'
import { decodeAudioBuffer, UndecodableAudioError } from './decodeAudio'
import {
  BASE_BUCKET_COUNT,
  computePeaks,
  type ComputedPeaks,
} from './computePeaks'

/** A run either produced peaks, or the audio was genuinely undecodable, or it errored transiently. */
export type PeakResult =
  | { ok: true; value: ComputedPeaks }
  | { ok: false; undecodable: boolean; error: string }

export async function computePeaksFromFile(
  filePath: string,
  targetBuckets: number = BASE_BUCKET_COUNT,
): Promise<PeakResult> {
  let bytes: Uint8Array
  try {
    bytes = await readFile(filePath)
  } catch (err) {
    // File missing / unreadable: transient, do NOT poison the cache.
    return { ok: false, undecodable: false, error: errMsg(err) }
  }
  try {
    const value = computePeaks(decodeAudioBuffer(bytes), targetBuckets)
    if (value.bucketCount === 0) {
      return { ok: false, undecodable: true, error: 'decoded audio was empty' }
    }
    return { ok: true, value }
  } catch (err) {
    return {
      ok: false,
      undecodable: err instanceof UndecodableAudioError,
      error: errMsg(err),
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
