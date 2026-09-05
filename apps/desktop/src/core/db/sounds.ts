import type { DB } from './index'
import type { Sound } from '../types'

interface SoundRow {
  id: number
  name: string
  username: string
  license_url: string
  license_name: string
  duration: number
  tags: string
  filesize: number
  type: string
  samplerate: number
  channels: number
  bitdepth: number
  preview_hq_mp3: string
  preview_lq_mp3: string
  preview_hq_ogg: string
  preview_lq_ogg: string
  waveform_m: string
  waveform_l: string
  spectral_m: string | null
  spectral_l: string | null
  url: string
  download_count: number
  avg_rating: number
  created: string
}

function rowToSound(r: SoundRow): Sound {
  const sound: Sound = {
    id: r.id,
    name: r.name,
    username: r.username,
    license: { url: r.license_url, name: r.license_name },
    duration: r.duration,
    tags: JSON.parse(r.tags) as string[],
    filesize: r.filesize,
    type: r.type,
    samplerate: r.samplerate,
    channels: r.channels,
    bitdepth: r.bitdepth,
    previewUrls: {
      hqMp3: r.preview_hq_mp3,
      lqMp3: r.preview_lq_mp3,
      hqOgg: r.preview_hq_ogg,
      lqOgg: r.preview_lq_ogg,
    },
    waveformUrls: { m: r.waveform_m, l: r.waveform_l },
    url: r.url,
    downloadCount: r.download_count,
    avgRating: r.avg_rating,
    created: r.created,
  }
  if (r.spectral_m != null && r.spectral_l != null) {
    sound.spectralUrls = { m: r.spectral_m, l: r.spectral_l }
  }
  return sound
}

const UPSERT_SQL = /* sql */ `
  INSERT INTO sounds (
    id, name, username, license_url, license_name, duration, tags, filesize,
    type, samplerate, channels, bitdepth,
    preview_hq_mp3, preview_lq_mp3, preview_hq_ogg, preview_lq_ogg,
    waveform_m, waveform_l, spectral_m, spectral_l,
    url, download_count, avg_rating, created,
    first_seen_at, updated_at
  ) VALUES (
    @id, @name, @username, @license_url, @license_name, @duration, @tags, @filesize,
    @type, @samplerate, @channels, @bitdepth,
    @preview_hq_mp3, @preview_lq_mp3, @preview_hq_ogg, @preview_lq_ogg,
    @waveform_m, @waveform_l, @spectral_m, @spectral_l,
    @url, @download_count, @avg_rating, @created,
    @now, @now
  )
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    username = excluded.username,
    license_url = excluded.license_url,
    license_name = excluded.license_name,
    duration = excluded.duration,
    tags = excluded.tags,
    filesize = excluded.filesize,
    type = excluded.type,
    samplerate = excluded.samplerate,
    channels = excluded.channels,
    bitdepth = excluded.bitdepth,
    preview_hq_mp3 = excluded.preview_hq_mp3,
    preview_lq_mp3 = excluded.preview_lq_mp3,
    preview_hq_ogg = excluded.preview_hq_ogg,
    preview_lq_ogg = excluded.preview_lq_ogg,
    waveform_m = excluded.waveform_m,
    waveform_l = excluded.waveform_l,
    spectral_m = excluded.spectral_m,
    spectral_l = excluded.spectral_l,
    url = excluded.url,
    download_count = excluded.download_count,
    avg_rating = excluded.avg_rating,
    created = excluded.created,
    updated_at = excluded.updated_at
`

function soundToParams(s: Sound, now: number): Record<string, unknown> {
  return {
    id: s.id,
    name: s.name,
    username: s.username,
    license_url: s.license.url,
    license_name: s.license.name,
    duration: s.duration,
    tags: JSON.stringify(s.tags),
    filesize: s.filesize,
    type: s.type,
    samplerate: s.samplerate,
    channels: s.channels,
    bitdepth: s.bitdepth,
    preview_hq_mp3: s.previewUrls.hqMp3,
    preview_lq_mp3: s.previewUrls.lqMp3,
    preview_hq_ogg: s.previewUrls.hqOgg,
    preview_lq_ogg: s.previewUrls.lqOgg,
    waveform_m: s.waveformUrls.m,
    waveform_l: s.waveformUrls.l,
    spectral_m: s.spectralUrls?.m ?? null,
    spectral_l: s.spectralUrls?.l ?? null,
    url: s.url,
    download_count: s.downloadCount,
    avg_rating: s.avgRating,
    created: s.created,
    now,
  }
}

/** Insert or update one Sound. `first_seen_at` is preserved on update. */
export function upsertSound(db: DB, s: Sound): void {
  db.prepare(UPSERT_SQL).run(soundToParams(s, Date.now()))
}

/** Insert or update many Sounds in a single transaction. */
export function upsertSounds(db: DB, sounds: readonly Sound[]): void {
  const now = Date.now()
  const stmt = db.prepare(UPSERT_SQL)
  const tx = db.transaction((rows: readonly Sound[]) => {
    for (const s of rows) stmt.run(soundToParams(s, now))
  })
  tx(sounds)
}

/**
 * Read the given ids back as `Sound`s, in the SAME order as `ids`. Ids with no
 * row are skipped (so a caller that lost a `sounds` row degrades to a shorter
 * page rather than throwing). Preserves duplicates in `ids` if any.
 */
export function getSoundsByIds(db: DB, ids: readonly number[]): Sound[] {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT * FROM sounds WHERE id IN (${placeholders})`)
    .all(...ids) as SoundRow[]
  const byId = new Map<number, Sound>()
  for (const r of rows) byId.set(r.id, rowToSound(r))
  const out: Sound[] = []
  for (const id of ids) {
    const s = byId.get(id)
    if (s) out.push(s)
  }
  return out
}
