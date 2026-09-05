import type { PeaksEntry } from '../store/usePeaks'

export type WaveformDisplayState =
  /** The Original is not on disk — download it to the Library first. */
  | 'no-original'
  /** Peaks are not resolved yet (or the content path is still loading). */
  | 'computing'
  /** Resolved, and no waveform will ever appear — show an inline error + guidance. */
  | 'unavailable'
  /** Peaks payload present — draw the canvas waveform. */
  | 'ready'

/**
 * `contentPath`: `undefined` while `getContentPath` is in flight, `null` when the
 * Original is not staged, else its absolute path.
 * `peaks`: the `usePeaks` entry — `undefined` (unresolved), `null` (resolved,
 * none), or a payload.
 */
export function waveformDisplayState(
  peaks: PeaksEntry,
  contentPath: string | null | undefined,
): WaveformDisplayState {
  if (contentPath === null) return 'no-original'
  if (contentPath === undefined) return 'computing'
  if (peaks === undefined) return 'computing'
  if (peaks === null || peaks.bucketCount === 0) return 'unavailable'
  return 'ready'
}
