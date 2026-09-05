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
