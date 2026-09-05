import type { SearchFilter, SearchSort } from '../../preload'

export const SORT_OPTIONS: ReadonlyArray<{ value: SearchSort; label: string }> = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'duration_asc', label: 'Duration (short → long)' },
  { value: 'duration_desc', label: 'Duration (long → short)' },
  { value: 'rating', label: 'Rating' },
  { value: 'downloads', label: 'Downloads' },
  { value: 'created', label: 'Date created' },
]

type License = NonNullable<SearchFilter['license']>

export const LICENSE_OPTIONS: ReadonlyArray<{ value: License; label: string }> = [
  { value: 'commercial', label: 'Usable in commercial work' },
  { value: 'cc0', label: 'CC0 only' },
  { value: 'cc-by', label: 'CC-BY only' },
  { value: 'cc-by-nc', label: 'CC-BY-NC only' },
  { value: 'sampling-plus', label: 'Sampling+ only' },
]

export const FILE_TYPES: readonly string[] = [
  'wav',
  'aiff',
  'flac',
  'mp3',
  'ogg',
  'm4a',
]

export const SAMPLE_RATES: readonly number[] = [
  22050, 32000, 44100, 48000, 88200, 96000,
]

export const BIT_DEPTHS: readonly number[] = [8, 16, 24, 32]

export const CHANNEL_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: 'Mono' },
  { value: 2, label: 'Stereo' },
]

export interface FilterChip {
  /** The `SearchFilter` keys this chip owns — removing it clears all of them. */
  keys: ReadonlyArray<keyof SearchFilter>
  label: string
}

/** One removable chip per active constraint, in a stable display order. */
export function activeFilterChips(f: SearchFilter): FilterChip[] {
  const chips: FilterChip[] = []

  if (f.durationMin != null || f.durationMax != null) {
    const lo = f.durationMin != null ? `${f.durationMin}s` : '0s'
    const hi = f.durationMax != null ? `${f.durationMax}s` : '∞'
    chips.push({ keys: ['durationMin', 'durationMax'], label: `Duration ${lo}–${hi}` })
  }
  if (f.sampleRate != null) {
    chips.push({ keys: ['sampleRate'], label: `${f.sampleRate / 1000} kHz` })
  }
  if (f.bitDepth != null) {
    chips.push({ keys: ['bitDepth'], label: `${f.bitDepth}-bit` })
  }
  if (f.channels != null) {
    const label =
      f.channels === 1 ? 'Mono' : f.channels === 2 ? 'Stereo' : `${f.channels} channels`
    chips.push({ keys: ['channels'], label })
  }
  if (f.fileType) {
    chips.push({ keys: ['fileType'], label: f.fileType.toUpperCase() })
  }
  if (f.license) {
    const label =
      LICENSE_OPTIONS.find((o) => o.value === f.license)?.label ?? String(f.license)
    chips.push({ keys: ['license'], label })
  }

  return chips
}

/** Whether any constraint at all is active. */
export function hasActiveFilter(f: SearchFilter): boolean {
  return activeFilterChips(f).length > 0
}
