// `download_log` access (migration 003).
//
// One row per Original fetched from Freesound. This is the app's local mirror of
// the user's Freesound download record, which the API does not expose a
// remaining-quota figure for. Freesound's limit is 2,000 Original downloads per
// rolling 24 h (`DOWNLOAD_QUOTA_WINDOW_MS` / `DOWNLOAD_QUOTA_LIMIT`), so the UI
// counts the rows newer than `now - 24h` and shows what is left.
//
// The log is append-only; nothing here deletes rows. `countDownloadsSince` only
// ever looks at a 24 h tail, so unbounded growth costs a query nothing (the
// `downloaded_at` index bounds it) — a housekeeping prune can come later.

import type { DB } from './index'

/** Rolling window Freesound measures the Original-download quota over. */
export const DOWNLOAD_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000

/** Freesound's cap on Original downloads within {@link DOWNLOAD_QUOTA_WINDOW_MS}. */
export const DOWNLOAD_QUOTA_LIMIT = 2000

/** Record that a Sound's Original was downloaded from Freesound at `now` (epoch ms). */
export function recordDownload(db: DB, soundId: number, now: number): void {
  db.prepare(
    'INSERT INTO download_log (sound_id, downloaded_at) VALUES (?, ?)',
  ).run(soundId, now)
}

/** How many Originals were downloaded at or after `since` (epoch ms). */
export function countDownloadsSince(db: DB, since: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM download_log WHERE downloaded_at >= ?')
    .get(since) as { n: number }
  return row.n
}
