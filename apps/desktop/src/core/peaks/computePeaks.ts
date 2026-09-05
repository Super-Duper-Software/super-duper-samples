import type { DecodedAudio } from './decodeAudio'

/**
 * Base envelope resolution: 2000 min/max pairs. A row waveform is ~110 px and the
 * largest inspection view is a window-width canvas (~1500 px at 2x DPR), so 2000
 * buckets over the whole file gives at least one bucket per pixel at 1x zoom and
 * headroom to zoom ~1.3x before hitting the base grid. Long recordings zoom
 * further than that by re-reading detail the base grid already smoothed, which is
 * an accepted v1 limit.
 */
export const BASE_BUCKET_COUNT = 2000

export interface ComputedPeaks {
  /** Source sample rate, kept for display / debugging (playhead math uses the media element). */
  sampleRate: number
  /** Number of min/max pairs actually produced (<= BASE_BUCKET_COUNT, and <= frame count). */
  bucketCount: number
  /**
   * Interleaved `[min0, max0, min1, max1, ...]`, one pair per bucket, each value
   * an Int16 in [-32767, 32767] (a linear scaling of the [-1, 1] sample value).
   * Length is `bucketCount * 2`.
   */
  data: Int16Array
}

const INT16_MAX = 32767

/**
 * Reduce decoded PCM to a min/max envelope. Peaks are taken across ALL channels
 * together (a mono summary is what the row waveform shows), so a loud transient
 * in either channel is never hidden.
 */
export function computePeaks(
  audio: DecodedAudio,
  targetBuckets: number = BASE_BUCKET_COUNT,
): ComputedPeaks {
  const { channelData, length, sampleRate } = audio
  const channels = channelData.length
  if (channels === 0 || length === 0) {
    return { sampleRate, bucketCount: 0, data: new Int16Array(0) }
  }

  const bucketCount = Math.max(1, Math.min(targetBuckets, length))
  const data = new Int16Array(bucketCount * 2)

  for (let b = 0; b < bucketCount; b++) {
    const start = Math.floor((b * length) / bucketCount)
    const end = Math.max(
      start + 1,
      Math.floor(((b + 1) * length) / bucketCount),
    )
    let min = 1
    let max = -1
    for (let c = 0; c < channels; c++) {
      const ch = channelData[c]!
      for (let i = start; i < end; i++) {
        const v = ch[i]!
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    if (min > max) {
      min = 0
      max = 0
    }
    data[b * 2] = clampInt16(min * INT16_MAX)
    data[b * 2 + 1] = clampInt16(max * INT16_MAX)
  }

  return { sampleRate, bucketCount, data }
}

function clampInt16(n: number): number {
  const r = Math.round(n)
  if (r < -INT16_MAX) return -INT16_MAX
  if (r > INT16_MAX) return INT16_MAX
  return r
}
