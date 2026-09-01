// Read an Original off disk and reduce it to a peak envelope (ticket 12). This is
// the unit of work that runs inside the peak Worker — it touches the filesystem
// and does the CPU-heavy sweep, but never SQLite and never Electron.

import { readFile } from 'node:fs/promises'
import {
  decodeAudioBuffer,
  UndecodableAudioError,
  type DecodedAudio,
} from './decodeAudio'
import {
  BASE_BUCKET_COUNT,
  computePeaks,
  type ComputedPeaks,
} from './computePeaks'

/** A run either produced peaks, or the audio was genuinely undecodable, or it errored transiently. */
export type PeakResult =
  | { ok: true; value: ComputedPeaks }
  | { ok: false; undecodable: boolean; error: string }

/** A `[start, end)` window in seconds — the same shape as `EditSpec['trim']`. */
export interface TrimWindow {
  startSec: number
  endSec: number
}

/**
 * Restrict decoded audio to a frame window (ticket 03 — an Edit's peaks are
 * sliced from its parent's decode rather than decoding the Edit's own exported
 * file). Bounds are clamped to the decoded length; always at least one frame.
 */
function sliceDecodedAudio(audio: DecodedAudio, trim: TrimWindow): DecodedAudio {
  const { sampleRate, length, channelData } = audio
  const start = Math.min(Math.max(Math.round(trim.startSec * sampleRate), 0), length)
  const end = Math.min(Math.max(Math.round(trim.endSec * sampleRate), start + 1), length)
  return {
    sampleRate,
    length: end - start,
    channelData: channelData.map((ch) => ch.subarray(start, end)),
  }
}

/**
 * Decode `filePath` and reduce it to a peak envelope. `trim`, when given,
 * slices the decoded audio to that window (in seconds) before the min/max
 * sweep — used to compute an Edit's peaks straight from its parent's decode.
 */
export async function computePeaksFromFile(
  filePath: string,
  targetBuckets: number = BASE_BUCKET_COUNT,
  trim?: TrimWindow | null,
): Promise<PeakResult> {
  let bytes: Uint8Array
  try {
    bytes = await readFile(filePath)
  } catch (err) {
    // File missing / unreadable: transient, do NOT poison the cache.
    return { ok: false, undecodable: false, error: errMsg(err) }
  }
  try {
    let decoded = decodeAudioBuffer(bytes)
    if (trim) decoded = sliceDecodedAudio(decoded, trim)
    const value = computePeaks(decoded, targetBuckets)
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
