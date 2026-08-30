// Translate the core's structured `sort` / `filter` (src/core/types.ts) into the
// exact query params Freesound's `/apiv2/search/text/` expects. Pure functions,
// no I/O — the HTTP gateway calls them, and tests assert their output verbatim.
//
// Verified against https://freesound.org/docs/api/resources_apiv2.html#text-search:
//   - `sort`   takes `score` (default), `duration_asc`, `duration_desc`,
//              `rating_desc`, `downloads_desc`, `created_desc`, …
//   - `filter` is a Solr-style string of space-separated `field:value` terms:
//              `duration:[1 TO 10] samplerate:44100 bitdepth:16 channels:2
//               type:wav license:"Attribution"`. Ranges use `[lo TO hi]` with an
//              uppercase `TO` and `*` for an open end; multi-word values are
//              quoted; `field:(a OR b)` unions values.

import type { LicenseFilter, SearchFilter, SearchSort } from '../types'

/** `SearchSort` → Freesound `sort=` value. */
const SORT_PARAM: Record<SearchSort, string> = {
  relevance: 'score',
  duration_asc: 'duration_asc',
  duration_desc: 'duration_desc',
  rating: 'rating_desc',
  downloads: 'downloads_desc',
  created: 'created_desc',
}

/**
 * Freesound `sort=` value for a `SearchSort`, or `undefined` for the default
 * (relevance / `score`) so a plain query's URL is unchanged.
 */
export function freesoundSortParam(
  sort: SearchSort | undefined,
): string | undefined {
  if (!sort || sort === 'relevance') return undefined
  return SORT_PARAM[sort]
}

/** Exact Freesound `license` field strings. */
export const FREESOUND_LICENSE = {
  cc0: 'Creative Commons 0',
  'cc-by': 'Attribution',
  'cc-by-nc': 'Attribution Noncommercial',
  'sampling-plus': 'Sampling+',
} as const satisfies Record<Exclude<LicenseFilter, 'commercial'>, string>

/**
 * The `license` values that permit commercial use. The "usable in commercial
 * work" control admits ONLY these, which is how CC-BY-NC and legacy Sampling+
 * are excluded before a single result is fetched.
 */
export const COMMERCIAL_LICENSES: readonly string[] = [
  FREESOUND_LICENSE['cc-by'],
  FREESOUND_LICENSE.cc0,
]

function licenseTerm(license: LicenseFilter): string {
  if (license === 'commercial') {
    return `license:(${COMMERCIAL_LICENSES.map((l) => `"${l}"`).join(' OR ')})`
  }
  return `license:"${FREESOUND_LICENSE[license]}"`
}

/**
 * Freesound `filter=` string for a `SearchFilter`, or `undefined` when nothing
 * is constrained (so a plain query's URL and cache key are unchanged).
 */
export function freesoundFilterString(
  filter: SearchFilter | undefined,
): string | undefined {
  if (!filter) return undefined

  const terms: string[] = []

  const { durationMin, durationMax } = filter
  if (durationMin != null || durationMax != null) {
    const lo = durationMin != null ? String(durationMin) : '*'
    const hi = durationMax != null ? String(durationMax) : '*'
    terms.push(`duration:[${lo} TO ${hi}]`)
  }
  if (filter.sampleRate != null) terms.push(`samplerate:${filter.sampleRate}`)
  if (filter.bitDepth != null) terms.push(`bitdepth:${filter.bitDepth}`)
  if (filter.channels != null) terms.push(`channels:${filter.channels}`)
  if (filter.fileType) terms.push(`type:${filter.fileType}`)
  if (filter.license) terms.push(licenseTerm(filter.license))

  return terms.length > 0 ? terms.join(' ') : undefined
}
