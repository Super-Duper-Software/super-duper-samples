// `peaks` table access (table created empty by migration 001).
//
// One row per Sound: the computed min/max waveform envelope for its Original,
// stored as a BLOB of interleaved Int16 `[min, max]` pairs. Written once by the
// peak service after a Worker decodes the Original; read by `core.getPeaks`;
// deleted when the Sound is removed from the Library or evicted from Staging so
// cached peaks never outlive the audio they describe.
//
// `bucket_count = 0` with an empty BLOB is the "this Original could not be
// decoded" sentinel — it stops the app from re-decoding an mp3/flac/ogg (or a
// corrupt file) on every visit while still letting `core.getPeaks` report "no
// peaks" so the renderer falls back to the Freesound image.

import type { DB } from './index'

export interface PeaksRecord {
  soundId: number
  sampleRate: number
  bucketCount: number
  /** Interleaved Int16 `[min,max]` per bucket. Empty when `bucketCount === 0`. */
  data: Buffer
  computedAt: number
}

interface PeaksRow {
  sound_id: number
  sample_rate: number
  bucket_count: number
  data: Buffer
  computed_at: number
}

export function getPeaksRecord(
  db: DB,
  soundId: number,
): PeaksRecord | undefined {
  const row = db
    .prepare('SELECT * FROM peaks WHERE sound_id = ?')
    .get(soundId) as PeaksRow | undefined
  if (!row) return undefined
  return {
    soundId: row.sound_id,
    sampleRate: row.sample_rate,
    bucketCount: row.bucket_count,
    data: row.data,
    computedAt: row.computed_at,
  }
}

export function hasPeaksRecord(db: DB, soundId: number): boolean {
  return (
    db.prepare('SELECT 1 FROM peaks WHERE sound_id = ?').get(soundId) !==
    undefined
  )
}

/** Insert or replace the peak envelope for a Sound. */
export function putPeaksRecord(
  db: DB,
  rec: Omit<PeaksRecord, 'computedAt'> & { computedAt?: number },
): void {
  db.prepare(
    `INSERT INTO peaks (sound_id, sample_rate, bucket_count, data, computed_at)
       VALUES (@soundId, @sampleRate, @bucketCount, @data, @computedAt)
     ON CONFLICT(sound_id) DO UPDATE SET
       sample_rate  = excluded.sample_rate,
       bucket_count = excluded.bucket_count,
       data         = excluded.data,
       computed_at  = excluded.computed_at`,
  ).run({
    soundId: rec.soundId,
    sampleRate: rec.sampleRate,
    bucketCount: rec.bucketCount,
    data: rec.data,
    computedAt: rec.computedAt ?? Date.now(),
  })
}

/** Remove a Sound's cached peaks. No-op when absent. */
export function deletePeaksRecord(db: DB, soundId: number): void {
  db.prepare('DELETE FROM peaks WHERE sound_id = ?').run(soundId)
}
