import { readFile } from 'node:fs/promises'
import { errorMessage } from '../errorMessage'
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
 * Runs one computation for a file. Resolves with the envelope or a typed
 * failure; an undecodable Original is `{ ok: false, undecodable: true }`, never
 * a throw.
 */
export type PeakRunner = (
  filePath: string,
  targetBuckets: number,
  /** Slice the decode to this window (seconds) first. */
  trim?: TrimWindow | null,
) => Promise<PeakResult>

/** Bounds are clamped to the decoded length; the window is always at least one frame. */
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
 * slices the decoded audio to that window before the min/max sweep.
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
    return { ok: false, undecodable: false, error: errorMessage(err) }
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
      error: errorMessage(err),
    }
  }
}
