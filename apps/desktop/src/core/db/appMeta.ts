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

/** Epoch ms at which the user acknowledged the staging notice. */
export const STAGING_CONSENT_KEY = 'staging_consent_at'

/** Ticket 18 — the persisted shell state blob (window bounds, last view/search/selection). */
export const UI_STATE_KEY = 'ui_state'
