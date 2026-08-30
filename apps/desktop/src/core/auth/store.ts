// The one persistent row of auth state: the `auth` table (migration 001, id = 1).
//
// What is persisted (spec 0001 § Persistence — "auth = the encrypted refresh
// token blob and access token expiry"):
//   - `refresh_token_enc`  — the OS-encrypted blob of a small JSON document
//     `{ refreshToken, username }`. Both the long-lived refresh token AND the
//     username live inside the SAME encrypted blob, so nothing readable is on
//     disk and no schema change was needed to carry the username.
//   - `access_token_expires` — epoch ms when the in-memory access token lapses.
//
// The access token itself is NEVER persisted — it is short-lived and stays in
// memory only (requirement 4).
//
// Encryption/decryption is done by the caller via `AuthPlatform.encrypt` /
// `.decrypt` (Electron `safeStorage`). `keytar` is not used.

import type { DB } from '../db/index'

/** The decrypted contents of the persisted blob. */
export interface PersistedSession {
  refreshToken: string
  username: string
}

/** A raw `auth` row, before decryption. */
export interface StoredAuthRow {
  refreshTokenEnc: Buffer
  accessTokenExpires: number | null
}

/** Read the single `auth` row, or `undefined` when signed out. */
export function readStoredAuth(db: DB): StoredAuthRow | undefined {
  const row = db
    .prepare(
      'SELECT refresh_token_enc AS enc, access_token_expires AS exp FROM auth WHERE id = 1',
    )
    .get() as { enc: Buffer | null; exp: number | null } | undefined
  if (!row || !row.enc) return undefined
  return { refreshTokenEnc: row.enc, accessTokenExpires: row.exp }
}

/** Insert-or-replace the single `auth` row. */
export function writeStoredAuth(
  db: DB,
  args: { refreshTokenEnc: Buffer; accessTokenExpires: number },
): void {
  db.prepare(
    `INSERT INTO auth (id, refresh_token_enc, access_token_expires)
       VALUES (1, @enc, @exp)
     ON CONFLICT(id) DO UPDATE SET
       refresh_token_enc = excluded.refresh_token_enc,
       access_token_expires = excluded.access_token_expires`,
  ).run({ enc: args.refreshTokenEnc, exp: args.accessTokenExpires })
}

/**
 * Delete the `auth` row. This is the WHOLE of what sign-out (and a dead refresh)
 * removes — `library_entries`, `sounds`, `collections`, `staged_entries`, `peaks`
 * and every downloaded file are untouched (requirement 10, CONTEXT.md § Account).
 */
export function clearStoredAuth(db: DB): void {
  db.prepare('DELETE FROM auth WHERE id = 1').run()
}
