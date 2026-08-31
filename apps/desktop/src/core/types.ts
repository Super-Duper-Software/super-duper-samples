// Domain types for the core command API. Plain data — no Electron, no I/O.

/** A Creative Commons license attached to a Sound (CONTEXT.md § License). */
export interface License {
  /** Canonical license deed URL as returned by Freesound. */
  url: string
  /** Short human label derived from the URL, e.g. "CC-BY", "CC0", "CC-BY-NC". */
  name: string
}

/** Lossy Preview renditions Freesound serves publicly (CONTEXT.md § Preview). */
export interface PreviewUrls {
  hqMp3: string
  lqMp3: string
  hqOgg: string
  lqOgg: string
}

/** Freesound's pre-rendered waveform images (medium / large). */
export interface WaveformUrls {
  m: string
  l: string
}

/** Freesound's pre-rendered spectrogram images (medium / large). */
export interface SpectralUrls {
  m: string
  l: string
}

/**
 * A single Freesound Sound, carrying the COMPLETE field set needed to render a
 * result row (ticket 03) from ONE search call — no per-Sound detail request is
 * ever made.
 */
export interface Sound {
  id: number
  name: string
  /** Uploading author's Freesound username. */
  username: string
  license: License
  /** Duration in seconds. */
  duration: number
  tags: string[]
  /** Original file size in bytes. */
  filesize: number
  /** Original file format, e.g. "wav", "aiff", "flac", "mp3". */
  type: string
  samplerate: number
  channels: number
  bitdepth: number
  previewUrls: PreviewUrls
  waveformUrls: WaveformUrls
  spectralUrls?: SpectralUrls
  /** The Sound's page on freesound.org. */
  url: string
  downloadCount: number
  avgRating: number
  /** ISO-8601 creation timestamp as returned by Freesound. */
  created: string
}

/**
 * Result ordering (ticket 15). `'relevance'` is Freesound's default text-match
 * score; the rest map to Freesound's `duration_asc` / `duration_desc` /
 * `rating_desc` / `downloads_desc` / `created_desc` sort values.
 */
export type SearchSort =
  | 'relevance'
  | 'duration_asc'
  | 'duration_desc'
  | 'rating'
  | 'downloads'
  | 'created'

/**
 * License pre-filter (ticket 15). `'commercial'` is the headline control —
 * "usable in commercial work": it admits ONLY CC0 and CC-BY, which excludes the
 * non-commercial material (CC-BY-NC and legacy Sampling+) a commercial user must
 * not build on. The other values pin the search to one specific license.
 *
 * This is a search-time convenience for not getting attached to unusable
 * material — it is NOT the License obligation itself (CONTEXT.md § License),
 * which still travels with every Sound regardless of how it was found.
 */
export type LicenseFilter =
  'commercial' | 'cc0' | 'cc-by' | 'cc-by-nc' | 'sampling-plus'

/**
 * Structured, pre-search constraints (ticket 15). Every field is optional; an
 * absent or all-empty filter constrains nothing. The gateway translates this to
 * Freesound's Solr-style `filter=` string; the core folds it into the search
 * cache key so a filtered query is cached and served independently.
 */
export interface SearchFilter {
  /** Minimum duration in seconds (inclusive). */
  durationMin?: number
  /** Maximum duration in seconds (inclusive). */
  durationMax?: number
  /** Exact sample rate in Hz, e.g. 44100 / 48000. */
  sampleRate?: number
  /** Exact bit depth, e.g. 16 / 24. */
  bitDepth?: number
  /** Exact channel count, e.g. 1 (mono) / 2 (stereo). */
  channels?: number
  /** Original file format, e.g. `'wav'` / `'aiff'` / `'flac'`. */
  fileType?: string
  /** License pre-filter — see {@link LicenseFilter}. */
  license?: LicenseFilter
}

/** The persisted active sort + filter state (ticket 15, stored in `app_meta`). */
export interface SearchPrefs {
  sort: SearchSort
  filter: SearchFilter
}

/**
 * A Library Sound plus the user's local overlay (ticket 13). `customName` and
 * `customTags` are the user's own vocabulary; the Freesound `name` / `tags`
 * inherited from {@link Sound} are still present and unchanged. `effectiveName`
 * is `customName ?? name` — the name that arrives in the DAW on a Drag-Out.
 */
export interface LibrarySound extends Sound {
  /** The user's own name for this Sound, or `null` when they have not renamed it. */
  customName: string | null
  /** `customName ?? name` — what a Drag-Out delivers on the file. */
  effectiveName: string
  /** The user's own tags, kept separate from the inherited Freesound `tags`. */
  customTags: string[]
  /** Epoch ms the Sound was saved to the Library. */
  savedAt: number
}

/**
 * Structured, database-only Library filter (ticket 13). Every field is optional;
 * an absent or all-empty filter returns the whole Library. Applied entirely from
 * the local database — it never triggers a network request. Dimensions compose
 * with AND; `tags` matches a Sound carrying ANY of the listed tags (inherited or
 * custom).
 */
export interface LibraryFilter {
  /** Match Sounds carrying ANY of these tags (case-insensitive; inherited or custom). */
  tags?: string[]
  /** License pre-filter — reuses {@link LicenseFilter}. */
  license?: LicenseFilter
  /** Minimum duration in seconds (inclusive). */
  durationMin?: number
  /** Maximum duration in seconds (inclusive). */
  durationMax?: number
  /** Original file format, e.g. `'wav'` / `'aiff'` (case-insensitive exact match). */
  fileType?: string
  /** Free text — matched against custom name, Freesound name, author and every tag. */
  text?: string
}

export interface SearchOptions {
  /** 1-based page number. Defaults to 1. */
  page?: number
  /** Results per page. Defaults to 15. */
  pageSize?: number
  /** Result ordering. Defaults to `'relevance'`. */
  sort?: SearchSort
  /** Structured pre-filter. Defaults to no constraint. */
  filter?: SearchFilter
}

export interface SearchResult {
  /** The query exactly as the caller passed it. */
  query: string
  /** Total matches for the query across all pages (0 means "nothing matched"). */
  totalCount: number
  page: number
  pageSize: number
  sounds: Sound[]
  /**
   * Whether at least one more page exists after this one — i.e. whether calling
   * `search(query, { page: page + 1 })` would return further Sounds. Lets the
   * renderer drive "load more on scroll" without re-deriving it from arithmetic
   * that the core owns. `false` on an empty result set and on the last page.
   */
  hasMore: boolean
}
