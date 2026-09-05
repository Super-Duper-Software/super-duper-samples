/** `34.72` -> `"0:35"`, `128` -> `"2:08"`, `3661` -> `"61:01"`. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.round(seconds)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * `34.723` -> `"0:34.72"` — one decimal of a second more than
 * {@link formatDuration}, for the Edit view's region readout where whole
 * seconds are too coarse to see an edge move.
 */
export function formatPreciseDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.00'
  const mins = Math.floor(seconds / 60)
  const secs = seconds - mins * 60
  return `${mins}:${secs.toFixed(2).padStart(5, '0')}`
}

/** `1873` -> `"1,873 results"`, `1` -> `"1 result"`, `0` -> `"No results"`. */
export function formatResultCount(totalCount: number): string {
  if (totalCount <= 0) return 'No results'
  const n = totalCount.toLocaleString('en-US')
  return `${n} ${totalCount === 1 ? 'result' : 'results'}`
}
