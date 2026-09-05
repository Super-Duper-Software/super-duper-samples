import type { License, Sound } from '../types'
import type { RawFreesoundSound } from './index'

/**
 * Derive a short license label from a Creative Commons deed URL. Order matters:
 * the more specific patterns must be tested first.
 */
export function licenseName(url: string): string {
  const u = url.toLowerCase()
  if (u.includes('publicdomain/zero') || u.includes('/zero/')) return 'CC0'
  if (u.includes('/by-nc-nd/')) return 'CC-BY-NC-ND'
  if (u.includes('/by-nc-sa/')) return 'CC-BY-NC-SA'
  if (u.includes('/by-nd/')) return 'CC-BY-ND'
  if (u.includes('/by-nc/')) return 'CC-BY-NC'
  if (u.includes('/by-sa/')) return 'CC-BY-SA'
  if (u.includes('/by/')) return 'CC-BY'
  if (u.includes('samplingplus') || u.includes('sampling+')) return 'Sampling+'
  return url
}

function toLicense(url: string): License {
  return { url, name: licenseName(url) }
}

/** Map a raw Freesound search result into the core's `Sound` shape. */
export function mapRawSound(raw: RawFreesoundSound): Sound {
  const sound: Sound = {
    id: raw.id,
    name: raw.name,
    username: raw.username,
    license: toLicense(raw.license),
    duration: raw.duration,
    tags: raw.tags ?? [],
    filesize: raw.filesize,
    type: raw.type,
    samplerate: raw.samplerate,
    channels: raw.channels,
    bitdepth: raw.bitdepth,
    previewUrls: {
      hqMp3: raw.previews['preview-hq-mp3'],
      lqMp3: raw.previews['preview-lq-mp3'],
      hqOgg: raw.previews['preview-hq-ogg'],
      lqOgg: raw.previews['preview-lq-ogg'],
    },
    waveformUrls: {
      m: raw.images.waveform_m,
      l: raw.images.waveform_l,
    },
    url: raw.url,
    downloadCount: raw.num_downloads,
    avgRating: raw.avg_rating,
    created: raw.created,
  }
  if (raw.images.spectral_m && raw.images.spectral_l) {
    sound.spectralUrls = { m: raw.images.spectral_m, l: raw.images.spectral_l }
  }
  return sound
}
