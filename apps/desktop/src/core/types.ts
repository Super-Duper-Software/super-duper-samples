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

export interface SearchOptions {
  /** 1-based page number. Defaults to 1. */
  page?: number
  /** Results per page. Defaults to 15. */
  pageSize?: number
}

export interface SearchResult {
  /** The query exactly as the caller passed it. */
  query: string
  /** Total matches for the query across all pages (0 means "nothing matched"). */
  totalCount: number
  page: number
  pageSize: number
  sounds: Sound[]
}
