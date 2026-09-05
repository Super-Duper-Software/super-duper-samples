import type { SearchFilter, SearchSort } from '../types'

/** Collapse the default sort to `undefined` so it drops out of gateway URLs and cache keys. */
export function normalizeSort(
  sort: SearchSort | undefined,
): SearchSort | undefined {
  return !sort || sort === 'relevance' ? undefined : sort
}

/** Keep only constraining entries; an all-empty filter becomes `undefined`. */
export function normalizeFilter(
  filter: SearchFilter | undefined,
): SearchFilter | undefined {
  if (!filter) return undefined
  const out: SearchFilter = {}
  if (filter.durationMin != null) out.durationMin = filter.durationMin
  if (filter.durationMax != null) out.durationMax = filter.durationMax
  if (filter.sampleRate != null) out.sampleRate = filter.sampleRate
  if (filter.bitDepth != null) out.bitDepth = filter.bitDepth
  if (filter.channels != null) out.channels = filter.channels
  if (filter.fileType) out.fileType = filter.fileType
  if (filter.license) out.license = filter.license
  return Object.keys(out).length > 0 ? out : undefined
}
