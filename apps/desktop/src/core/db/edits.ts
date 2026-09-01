// `sounds` rows that are Edits (migration 004, ADR-0005). An Edit is a
// negative-id row in the SAME `sounds` table every real Sound lives in, so
// `getSoundsByIds` / `upsertSound` etc. already read and write its base Sound
// fields for free. This module owns only the three Edit-only columns
// (`derived_from`, `edit_spec`, `local_path`) and the negative-id minting.

import type { DB } from './index'
import type { EditSpec, Sound } from '../types'

/** The three Edit-only columns, for a single `sounds` row. */
export interface EditFields {
  derivedFrom: number | null
  editSpec: EditSpec | null
  localPath: string | null
}

interface EditFieldsRow {
  id: number
  derived_from: number | null
  edit_spec: string | null
  local_path: string | null
}

function rowToEditFields(r: EditFieldsRow): EditFields {
  let editSpec: EditSpec | null = null
  if (r.edit_spec) {
    try {
      editSpec = JSON.parse(r.edit_spec) as EditSpec
    } catch {
      editSpec = null // a corrupt blob degrades to "not an Edit" rather than throwing
    }
  }
  return { derivedFrom: r.derived_from, editSpec, localPath: r.local_path }
}

/** The Edit-only fields for a set of `sounds` rows, keyed by id. Ids that are not Edits are absent. */
export function getEditFieldsByIds(
  db: DB,
  ids: readonly number[],
): Map<number, EditFields> {
  const out = new Map<number, EditFields>()
  if (ids.length === 0) return out
  const placeholders = ids.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT id, derived_from, edit_spec, local_path FROM sounds
         WHERE id IN (${placeholders}) AND derived_from IS NOT NULL`,
    )
    .all(...ids) as EditFieldsRow[]
  for (const r of rows) out.set(r.id, rowToEditFields(r))
  return out
}

/**
 * The next free negative id: one less than the smallest (most negative)
 * existing Edit id, or `-1` if there are none yet. Minted locally — ids are
 * never sent anywhere external, so there is no need for a dedicated sequence.
 */
export function nextEditId(db: DB): number {
  const row = db
    .prepare('SELECT MIN(id) AS minId FROM sounds WHERE id < 0')
    .get() as { minId: number | null }
  return row.minId == null ? -1 : row.minId - 1
}

/**
 * The effective names (custom name, falling back to the Sound name) of every
 * existing Edit of a given parent — what the `edited` / `edited (N)` picker
 * scans to find the next free name.
 */
export function listEditNamesForParent(
  db: DB,
  parentSoundId: number,
): string[] {
  const rows = db
    .prepare(
      `SELECT s.name AS name, le.custom_name AS custom_name
         FROM sounds s
         JOIN library_entries le ON le.sound_id = s.id
        WHERE s.derived_from = ?`,
    )
    .all(parentSoundId) as { name: string; custom_name: string | null }[]
  return rows.map((r) => r.custom_name ?? r.name)
}

export interface InsertEditSoundParams {
  editId: number
  parentSoundId: number
  editSpec: EditSpec
  localPath: string
  /** The Edit's own Sound metadata (name = the picked `edited` / `edited (N)`; license/author/url inherited from the parent). */
  sound: Omit<Sound, 'id'>
}

/** Insert the negative-id `sounds` row for a freshly rendered Edit. */
export function insertEditSoundRow(db: DB, p: InsertEditSoundParams): void {
  const now = Date.now()
  db.prepare(
    `INSERT INTO sounds (
       id, name, username, license_url, license_name, duration, tags, filesize,
       type, samplerate, channels, bitdepth,
       preview_hq_mp3, preview_lq_mp3, preview_hq_ogg, preview_lq_ogg,
       waveform_m, waveform_l, spectral_m, spectral_l,
       url, download_count, avg_rating, created,
       first_seen_at, updated_at,
       derived_from, edit_spec, local_path
     ) VALUES (
       @id, @name, @username, @license_url, @license_name, @duration, @tags, @filesize,
       @type, @samplerate, @channels, @bitdepth,
       @preview_hq_mp3, @preview_lq_mp3, @preview_hq_ogg, @preview_lq_ogg,
       @waveform_m, @waveform_l, @spectral_m, @spectral_l,
       @url, @download_count, @avg_rating, @created,
       @now, @now,
       @derived_from, @edit_spec, @local_path
     )`,
  ).run({
    id: p.editId,
    name: p.sound.name,
    username: p.sound.username,
    license_url: p.sound.license.url,
    license_name: p.sound.license.name,
    duration: p.sound.duration,
    tags: JSON.stringify(p.sound.tags),
    filesize: p.sound.filesize,
    type: p.sound.type,
    samplerate: p.sound.samplerate,
    channels: p.sound.channels,
    bitdepth: p.sound.bitdepth,
    preview_hq_mp3: p.sound.previewUrls.hqMp3,
    preview_lq_mp3: p.sound.previewUrls.lqMp3,
    preview_hq_ogg: p.sound.previewUrls.hqOgg,
    preview_lq_ogg: p.sound.previewUrls.lqOgg,
    waveform_m: p.sound.waveformUrls.m,
    waveform_l: p.sound.waveformUrls.l,
    spectral_m: p.sound.spectralUrls?.m ?? null,
    spectral_l: p.sound.spectralUrls?.l ?? null,
    url: p.sound.url,
    download_count: p.sound.downloadCount,
    avg_rating: p.sound.avgRating,
    created: p.sound.created,
    now,
    derived_from: p.parentSoundId,
    edit_spec: JSON.stringify(p.editSpec),
    local_path: p.localPath,
  })
}

/**
 * The id of an already-recovered Edit at this exact file path, if any (ticket
 * 06). Ids are re-minted on every rebuild, so a sidecar's OLD id cannot be used
 * to detect "already recovered" — the file path is the only thing stable
 * across runs.
 */
export function findEditIdByLocalPath(db: DB, localPath: string): number | null {
  const row = db
    .prepare(
      'SELECT id FROM sounds WHERE derived_from IS NOT NULL AND local_path = ?',
    )
    .get(localPath) as { id: number } | undefined
  return row?.id ?? null
}

/** Delete a `sounds` row outright. Used only for an Edit removed from the Library — an Edit has no existence outside it. */
export function deleteSoundRow(db: DB, soundId: number): void {
  db.prepare('DELETE FROM sounds WHERE id = ?').run(soundId)
}
