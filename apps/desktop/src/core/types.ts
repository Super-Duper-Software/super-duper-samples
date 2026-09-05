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
 * A single Freesound Sound, carrying the complete field set needed to render a
 * result row from ONE search call — no per-Sound detail request is ever made.
 */
export interface Sound {
  id: number
  name: string
  /** Uploading author's Freesound username. */
  username: string
  license: License
  /** Seconds. */
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
 * Result ordering. `'relevance'` is Freesound's text-match score; the rest map
 * to its `duration_asc` / `duration_desc` / `rating_desc` / `downloads_desc` /
 * `created_desc` sort values.
 */
export type SearchSort =
  | 'relevance'
  | 'duration_asc'
  | 'duration_desc'
  | 'rating'
  | 'downloads'
  | 'created'

/**
 * License pre-filter. `'commercial'` — "usable in commercial work" — admits ONLY
 * CC0 and CC-BY; the other values pin the search to one specific license.
 *
 * A search-time convenience, NOT the License obligation itself, which travels
 * with every Sound regardless of how it was found.
 */
export type LicenseFilter =
  | 'commercial'
  | 'cc0'
  | 'cc-by'
  | 'cc-by-nc'
  | 'sampling-plus'

/**
 * Pre-search constraints. An absent or all-empty filter constrains nothing. The
 * gateway translates this to Freesound's Solr-style `filter=` string; the core
 * folds it into the cache key so a filtered query is cached independently.
 */
export interface SearchFilter {
  /** Seconds, inclusive. */
  durationMin?: number
  /** Seconds, inclusive. */
  durationMax?: number
  /** Hz, e.g. 44100 / 48000. */
  sampleRate?: number
  /** e.g. 16 / 24. */
  bitDepth?: number
  /** e.g. 1 (mono) / 2 (stereo). */
  channels?: number
  /** Original file format, e.g. `'wav'` / `'aiff'` / `'flac'`. */
  fileType?: string
  license?: LicenseFilter
}

/** The persisted active sort + filter state (stored in `app_meta`). */
export interface SearchPrefs {
  sort: SearchSort
  filter: SearchFilter
}

/**
 * The trim + encode instructions for an Edit (ADR-0005). Persisted verbatim as
 * `sounds.edit_spec` JSON and passed to `createEdit`.
 */
export interface EditSpec {
  /** `null` = whole file. */
  trim: { startSec: number; endSec: number } | null
  format: 'wav' | 'mp3' | 'flac' | 'ogg'
  /** Omit to keep the source sample rate. */
  sampleRate?: number
  /** Omit to keep the source channel count. */
  channels?: 1 | 2
  /** Omit / false = no loudness normalise. */
  normalize?: boolean
}

/**
 * A Library Sound plus the user's local overlay. The inherited Freesound `name`
 * / `tags` are still present and unchanged.
 *
 * `derivedFrom` / `editSpec` are non-null exactly when this row is an **Edit**
 * (ADR-0005) — a derived local Sound with a negative `id`.
 */
export interface LibrarySound extends Sound {
  /** The user's own name, or `null` when they have not renamed it. */
  customName: string | null
  /** `customName ?? name` — what a Drag-Out delivers on the file. */
  effectiveName: string
  /** The user's own tags, kept separate from the inherited Freesound `tags`. */
  customTags: string[]
  /** Epoch ms the Sound was saved to the Library. */
  savedAt: number
  derivedFrom: number | null
  editSpec: EditSpec | null
}

/**
 * Library filter, applied entirely from the local database — it never triggers a
 * network request. Dimensions compose with AND.
 */
export interface LibraryFilter {
  /** Sounds carrying ANY of these tags (case-insensitive; inherited or custom). */
  tags?: string[]
  license?: LicenseFilter
  /** Seconds, inclusive. */
  durationMin?: number
  /** Seconds, inclusive. */
  durationMax?: number
  /** Case-insensitive exact match, e.g. `'wav'` / `'aiff'`. */
  fileType?: string
  /** Free text — matched against custom name, Freesound name, author and every tag. */
  text?: string
}

/**
 * A Collection with its current member count. A Collection is a user-named,
 * unordered set of Library Sounds; it does not nest and has no existence on disk
 * (ADR-0002).
 */
export interface CollectionSummary {
  id: number
  name: string
  count: number
}

/** A minimal Collection reference, for the per-Sound membership badges. */
export interface CollectionRef {
  id: number
  name: string
}

export interface SearchOptions {
  /** 1-based. Defaults to 1. */
  page?: number
  /** Defaults to 15. */
  pageSize?: number
  /** Defaults to `'relevance'`. */
  sort?: SearchSort
  filter?: SearchFilter
}

export interface SearchResult {
  /** The query exactly as the caller passed it. */
  query: string
  /** Total matches across all pages. */
  totalCount: number
  page: number
  pageSize: number
  sounds: Sound[]
  /**
   * Whether `search(query, { page: page + 1 })` would return further Sounds, so
   * the renderer can drive "load more on scroll" without re-deriving it.
   */
  hasMore: boolean
}
