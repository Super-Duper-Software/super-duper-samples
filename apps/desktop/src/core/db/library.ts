// `library_entries` access (migration 001).
//
// A row here means: the user has explicitly chosen to KEEP this Sound on this
// device (CONTEXT.md § Library). Library membership is a statement of *intent*,
// not of disk presence — a Staged Sound is equally on disk but has no row here.
//
// Saving is a pure DB write: `saveLibraryEntry` inserts one row and, if the
// Sound was Staged, drops its `staged_entries` row (the file itself is never
// moved or copied — that is what makes saving instant, ADR-0003). The insert is
// idempotent: saving an already-saved Sound keeps the original `saved_at` and
// never creates a duplicate.
//
// `custom_name` / `custom_tags` are the user's overlay — written by ticket 13,
// left NULL here.

import type { DB } from './index'

export { hasLibraryEntry } from './staged'

/** Sort options for `listLibrarySoundIds`. Only "date saved" exists for now. */
export type LibrarySort = 'savedAt'
export type SortDir = 'asc' | 'desc'

/**
 * Promote a Sound into the Library. Idempotent — an existing row is left exactly
 * as it was (`INSERT … ON CONFLICT DO NOTHING`), so `saved_at` never moves and a
 * duplicate is impossible. If the Sound was Staged, its `staged_entries` row is
 * removed in the same transaction: the bytes are unchanged on disk, only the
 * user's intent (and therefore the disk-accounting bucket) changes.
 *
 * The caller must have ensured a `sounds` row exists (the FK enforces it).
 */
export function saveLibraryEntry(db: DB, soundId: number, now: number): void {
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO library_entries (sound_id, saved_at)
         VALUES (?, ?)
       ON CONFLICT(sound_id) DO NOTHING`,
    ).run(soundId, now)
    db.prepare('DELETE FROM staged_entries WHERE sound_id = ?').run(soundId)
  })
  tx()
}

/** Remove a Sound's Library row. No-op if it was not in the Library. */
export function deleteLibraryEntry(db: DB, soundId: number): void {
  db.prepare('DELETE FROM library_entries WHERE sound_id = ?').run(soundId)
}

/**
 * Library Sound ids, ordered by the date they were saved. `desc` (the default at
 * the call site) is newest-first — "what did I gather for this project".
 */
export function listLibrarySoundIds(
  db: DB,
  dir: SortDir = 'desc',
): number[] {
  const order = dir === 'asc' ? 'ASC' : 'DESC'
  const rows = db
    .prepare(
      `SELECT sound_id FROM library_entries
         ORDER BY saved_at ${order}, sound_id ${order}`,
    )
    .all() as { sound_id: number }[]
  return rows.map((r) => r.sound_id)
}

/**
 * Batch membership for search-result badging: `{ [id]: true|false }` for every
 * id asked about, in one indexed query. Ids not in the Library map to `false`.
 */
export function libraryMembership(
  db: DB,
  ids: readonly number[],
): Record<number, boolean> {
  const out: Record<number, boolean> = {}
  for (const id of ids) out[id] = false
  if (ids.length === 0) return out
  const placeholders = ids.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT sound_id FROM library_entries WHERE sound_id IN (${placeholders})`,
    )
    .all(...ids) as { sound_id: number }[]
  for (const r of rows) out[r.sound_id] = true
  return out
}
