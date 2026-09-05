import type { LibraryFilter, LibrarySound, LicenseFilter } from '../types'

/**
 * The `sounds.license_name` values (as derived by `gateway/mapRawSound`) each
 * `LicenseFilter` admits. `'commercial'` admits ONLY CC0 + CC-BY — the same
 * "usable in commercial work" semantics as the ticket-15 search filter.
 */
export const LICENSE_FILTER_NAMES: Record<LicenseFilter, readonly string[]> = {
  commercial: ['CC0', 'CC-BY'],
  cc0: ['CC0'],
  'cc-by': ['CC-BY'],
  'cc-by-nc': ['CC-BY-NC'],
  'sampling-plus': ['Sampling+'],
}

/** Trim, lower-case and drop empties from a tag list. */
export function normaliseTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const t = raw.trim()
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

/** Every tag on a Sound the filter can match against — inherited plus the user's own. */
function allTags(sound: LibrarySound): string[] {
  return [...sound.tags, ...sound.customTags]
}

export function matchesLibraryFilter(
  sound: LibrarySound,
  filter: LibraryFilter,
): boolean {
  if (filter.durationMin != null && sound.duration < filter.durationMin)
    return false
  if (filter.durationMax != null && sound.duration > filter.durationMax)
    return false

  if (filter.fileType) {
    if (sound.type.toLowerCase() !== filter.fileType.toLowerCase()) return false
  }

  if (filter.license) {
    const allowed = LICENSE_FILTER_NAMES[filter.license]
    if (!allowed.includes(sound.license.name)) return false
  }

  if (filter.tags && filter.tags.length > 0) {
    const wanted = new Set(
      normaliseTags(filter.tags).map((t) => t.toLowerCase()),
    )
    const have = new Set(allTags(sound).map((t) => t.toLowerCase()))
    let hit = false
    for (const w of wanted) {
      if (have.has(w)) {
        hit = true
        break
      }
    }
    if (!hit) return false
  }

  if (filter.text && filter.text.trim() !== '') {
    const needle = filter.text.trim().toLowerCase()
    const haystack = [
      sound.customName ?? '',
      sound.name,
      sound.username,
      ...allTags(sound),
    ]
      .join('\n')
      .toLowerCase()
    if (!haystack.includes(needle)) return false
  }

  return true
}

/** Whether a filter constrains anything at all. */
export function hasLibraryFilter(filter: LibraryFilter | undefined): boolean {
  if (!filter) return false
  return (
    (filter.tags != null && filter.tags.length > 0) ||
    filter.license != null ||
    filter.durationMin != null ||
    filter.durationMax != null ||
    (filter.fileType != null && filter.fileType !== '') ||
    (filter.text != null && filter.text.trim() !== '')
  )
}

/**
 * Drop empty entries so an all-empty filter round-trips as `{}` (mirrors the
 * ticket-15 `normalizeFilter`). Used before persisting and before the cache-free
 * `filterLibrary` read.
 */
export function normaliseLibraryFilter(
  filter: LibraryFilter | undefined,
): LibraryFilter {
  const out: LibraryFilter = {}
  if (!filter) return out
  const tags = filter.tags ? normaliseTags(filter.tags) : []
  if (tags.length > 0) out.tags = tags
  if (filter.license) out.license = filter.license
  if (filter.durationMin != null) out.durationMin = filter.durationMin
  if (filter.durationMax != null) out.durationMax = filter.durationMax
  if (filter.fileType) out.fileType = filter.fileType
  if (filter.text != null && filter.text.trim() !== '')
    out.text = filter.text.trim()
  return out
}
