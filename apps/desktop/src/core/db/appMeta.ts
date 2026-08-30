// `app_meta` — a tiny key/value store for one-off app flags (migration 002).
// Ticket 08 uses it for `staging_consent_at`; later tickets may add more keys.

import type { DB } from './index'

/** Read a meta value, or `null` when the key is unset. */
export function getMeta(db: DB, key: string): string | null {
  const row = db
    .prepare('SELECT value FROM app_meta WHERE key = ?')
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

/** Insert-or-replace a meta value. */
export function setMeta(db: DB, key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value)
}

/** The one key ticket 08 owns: epoch ms the user acknowledged the staging notice. */
export const STAGING_CONSENT_KEY = 'staging_consent_at'
