import type { DB } from './index'
import type { CollectionRef, CollectionSummary } from '../types'

export type { CollectionRef, CollectionSummary } from '../types'

/** Insert a new Collection. Returns its generated id. */
export function insertCollection(db: DB, name: string, now: number): number {
  const info = db
    .prepare('INSERT INTO collections (name, created_at) VALUES (?, ?)')
    .run(name, now)
  return Number(info.lastInsertRowid)
}

/** Rename a Collection. No-op if the id does not exist. */
export function updateCollectionName(db: DB, id: number, name: string): void {
  db.prepare('UPDATE collections SET name = ? WHERE id = ?').run(name, id)
}

/**
 * Delete a Collection: its `collections` row and — via `ON DELETE CASCADE` — its
 * `collection_members` rows. The member Sounds stay in the Library and in every
 * other Collection. No-op if the id does not exist.
 */
export function deleteCollectionRow(db: DB, id: number): void {
  db.prepare('DELETE FROM collections WHERE id = ?').run(id)
}

/** Whether a Collection with this id exists. */
export function hasCollection(db: DB, id: number): boolean {
  return (
    db.prepare('SELECT 1 FROM collections WHERE id = ?').get(id) !== undefined
  )
}

/** A Collection's current name, or `null` if the id does not exist. */
export function getCollectionName(db: DB, id: number): string | null {
  const row = db
    .prepare('SELECT name FROM collections WHERE id = ?')
    .get(id) as { name: string } | undefined
  return row?.name ?? null
}

/**
 * Add many Sounds to one Collection in a single transaction. Idempotent — a
 * Sound already in the Collection is left as it was (its `added_at` does not
 * move) and no duplicate row is created.
 *
 * The caller guarantees each Sound is in the Library (a Collection is a set of
 * Library Sounds) and that a `sounds` row exists (the FK enforces the latter).
 */
export function addMembers(
  db: DB,
  collectionId: number,
  soundIds: readonly number[],
  now: number,
): void {
  if (soundIds.length === 0) return
  const stmt = db.prepare(
    `INSERT INTO collection_members (collection_id, sound_id, added_at)
       VALUES (?, ?, ?)
     ON CONFLICT(collection_id, sound_id) DO NOTHING`,
  )
  const tx = db.transaction((ids: readonly number[]) => {
    for (const id of ids) stmt.run(collectionId, id, now)
  })
  tx(soundIds)
}

/**
 * Remove one Sound from one Collection — deletes only the join row. No-op if the
 * Sound was not in the Collection.
 */
export function removeMember(
  db: DB,
  collectionId: number,
  soundId: number,
): void {
  db.prepare(
    'DELETE FROM collection_members WHERE collection_id = ? AND sound_id = ?',
  ).run(collectionId, soundId)
}

/**
 * Clear a Sound from EVERY Collection it belongs to. Called from
 * `deleteFromLibrary` (which keeps the `sounds` row, so the FK cascade does not
 * fire). No-op if the Sound was in no Collection.
 */
export function clearSoundFromAllCollections(db: DB, soundId: number): void {
  db.prepare('DELETE FROM collection_members WHERE sound_id = ?').run(soundId)
}

/**
 * Every Collection with its member count, ordered by name (case-insensitively),
 * then id. Served entirely from the database.
 */
export function listCollectionSummaries(db: DB): CollectionSummary[] {
  const rows = db
    .prepare(
      `SELECT c.id AS id, c.name AS name,
              (SELECT COUNT(*) FROM collection_members m
                 WHERE m.collection_id = c.id) AS count
         FROM collections c
        ORDER BY c.name COLLATE NOCASE ASC, c.id ASC`,
    )
    .all() as CollectionSummary[]
  return rows
}

/**
 * The Sound ids in a Collection, most-recently-added first. Restricted to
 * Sounds still in the Library — membership and Library membership are kept in
 * step (a Library delete clears memberships), so this is belt-and-braces.
 */
export function listCollectionMemberIds(
  db: DB,
  collectionId: number,
  dir: 'asc' | 'desc' = 'desc',
): number[] {
  const order = dir === 'asc' ? 'ASC' : 'DESC'
  const rows = db
    .prepare(
      `SELECT m.sound_id AS sound_id
         FROM collection_members m
         JOIN library_entries le ON le.sound_id = m.sound_id
        WHERE m.collection_id = ?
        ORDER BY m.added_at ${order}, m.sound_id ${order}`,
    )
    .all(collectionId) as { sound_id: number }[]
  return rows.map((r) => r.sound_id)
}

/**
 * For each requested Sound id, the Collections it belongs to (`{ id, name }`,
 * ordered by name). Every requested id appears in the result — mapped to `[]`
 * when the Sound is in no Collection. One indexed query.
 */
export function collectionsForSounds(
  db: DB,
  soundIds: readonly number[],
): Record<number, CollectionRef[]> {
  const out: Record<number, CollectionRef[]> = {}
  for (const id of soundIds) out[id] = []
  if (soundIds.length === 0) return out
  const placeholders = soundIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT m.sound_id AS sound_id, c.id AS id, c.name AS name
         FROM collection_members m
         JOIN collections c ON c.id = m.collection_id
        WHERE m.sound_id IN (${placeholders})
        ORDER BY c.name COLLATE NOCASE ASC, c.id ASC`,
    )
    .all(...soundIds) as { sound_id: number; id: number; name: string }[]
  for (const r of rows) {
    ;(out[r.sound_id] ??= []).push({ id: r.id, name: r.name })
  }
  return out
}
