// The database. Opened in the CORE — which is the Electron main process in
// production and a plain Node process under test — and NEVER on the renderer's
// thread (the renderer only ever calls `window.core.*`). See README § Database.
//
// `better-sqlite3` is synchronous. For this ticket every DB touch is a tiny
// indexed read or a single-row write, so doing it inline in the core is fine.
// Heavier work introduced by later tickets (peak compute, sidecar rebuild, bulk
// eviction) must move off the main thread via `worker_threads`.

import { existsSync } from 'node:fs'
import Database from 'better-sqlite3'
import { MIGRATIONS, type Migration } from './migrations'

export type DB = Database.Database

/**
 * Verdict on whether the database at a path can be used (ticket 14). Anything
 * other than `{ ok: true }` is a cue for `src/main` to offer a rebuild from
 * sidecars rather than launch into a broken app or a silently empty Library.
 *
 *   - `missing`           — no file there at all (a fresh install, OR a deleted DB).
 *   - `unreadable`        — the file exists but SQLite cannot open it, or
 *                           `PRAGMA quick_check` fails (corruption, truncation).
 *   - `schema-incomplete` — opens fine but the core's tables are not all present
 *                           (a botched migration, or a hand-created empty file).
 */
export type DbHealth =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'unreadable' | 'schema-incomplete' }

/**
 * Probe `dbPath` WITHOUT migrating or creating it — a read-only open plus an
 * integrity and schema check. Call this BEFORE `openDb` (which would paper over
 * a missing or blank database by creating the schema fresh). `':memory:'` is
 * always reported healthy.
 */
export function inspectDbHealth(dbPath: string): DbHealth {
  if (dbPath !== ':memory:' && !existsSync(dbPath)) {
    return { ok: false, reason: 'missing' }
  }
  let probe: Database.Database
  try {
    probe = new Database(dbPath, {
      readonly: true,
      fileMustExist: dbPath !== ':memory:',
    })
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  try {
    const check = probe.pragma('quick_check', { simple: true })
    if (check !== 'ok') return { ok: false, reason: 'unreadable' }
    const row = probe
      .prepare(
        `SELECT COUNT(*) AS n FROM sqlite_master
           WHERE type = 'table' AND name IN ('sounds', 'library_entries')`,
      )
      .get() as { n: number }
    if (row.n < 2) return { ok: false, reason: 'schema-incomplete' }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'unreadable' }
  } finally {
    probe.close()
  }
}

/**
 * Open (creating if absent) the database at `dbPath`, enforce foreign keys, and
 * bring the schema up to date. Idempotent: opening an already-current database
 * runs no migrations.
 *
 * `dbPath` may be `':memory:'`; tests point it at a file in a temp dir so that
 * persistence across `createCore` instances is exercised for real.
 */
export function openDb(dbPath: string): DB {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

/**
 * Apply every migration whose id is greater than the database's current
 * `user_version`, each inside its own transaction, then stamp `user_version`.
 * Exported so a test can assert the "opening twice is a no-op" property directly.
 */
export function runMigrations(db: DB): { applied: number[] } {
  // A tiny audit trail. `user_version` is the source of truth for "what's
  // applied"; this table just records when, for debugging.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `)

  const current = db.pragma('user_version', { simple: true }) as number
  const pending = MIGRATIONS.filter((m) => m.id > current).sort(
    (a, b) => a.id - b.id,
  )

  const applied: number[] = []
  for (const m of pending) applyOne(db, m), applied.push(m.id)

  return { applied }
}

function applyOne(db: DB, m: Migration): void {
  const tx = db.transaction(() => {
    db.exec(m.up)
    db.prepare(
      'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)',
    ).run(m.id, m.name, Date.now())
    // `user_version` cannot be parameterized.
    db.pragma(`user_version = ${m.id}`)
  })
  tx()
}
