import type { DB } from './index'

export interface StagedEntry {
  soundId: number
  byteSize: number
  lastAccessAt: number
  path: string | null
  createdAt: number | null
}

interface StagedRow {
  sound_id: number
  byte_size: number
  last_access_at: number
  path: string | null
  created_at: number | null
}

function rowToEntry(r: StagedRow): StagedEntry {
  return {
    soundId: r.sound_id,
    byteSize: r.byte_size,
    lastAccessAt: r.last_access_at,
    path: r.path,
    createdAt: r.created_at,
  }
}

/** Read one staged entry, or `undefined`. */
export function getStagedEntry(db: DB, soundId: number): StagedEntry | undefined {
  const row = db
    .prepare('SELECT * FROM staged_entries WHERE sound_id = ?')
    .get(soundId) as StagedRow | undefined
  return row ? rowToEntry(row) : undefined
}

/** All staged entries (ticket 10 will sort these LRU-first). */
export function listStagedEntries(db: DB): StagedEntry[] {
  const rows = db
    .prepare('SELECT * FROM staged_entries ORDER BY last_access_at ASC')
    .all() as StagedRow[]
  return rows.map(rowToEntry)
}

export function hasStagedEntry(db: DB, soundId: number): boolean {
  return (
    db
      .prepare('SELECT 1 FROM staged_entries WHERE sound_id = ?')
      .get(soundId) !== undefined
  )
}

export function hasLibraryEntry(db: DB, soundId: number): boolean {
  return (
    db
      .prepare('SELECT 1 FROM library_entries WHERE sound_id = ?')
      .get(soundId) !== undefined
  )
}

/**
 * Insert (or update) the staged row for a Sound whose Original just landed.
 * `created_at` is preserved on update; `last_access_at` is set to `now`.
 */
export function upsertStagedEntry(
  db: DB,
  args: { soundId: number; byteSize: number; path: string; now: number },
): void {
  db.prepare(
    `INSERT INTO staged_entries (sound_id, byte_size, last_access_at, path, created_at)
       VALUES (@soundId, @byteSize, @now, @path, @now)
     ON CONFLICT(sound_id) DO UPDATE SET
       byte_size      = excluded.byte_size,
       last_access_at = excluded.last_access_at,
       path           = excluded.path`,
  ).run(args)
}

/** Bump `last_access_at` for an already-staged Sound (a re-audition). No-op if absent. */
export function touchStagedEntry(db: DB, soundId: number, now: number): void {
  db.prepare(
    'UPDATE staged_entries SET last_access_at = ? WHERE sound_id = ?',
  ).run(now, soundId)
}
