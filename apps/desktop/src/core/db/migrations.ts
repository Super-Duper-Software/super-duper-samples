// Ordered, append-only list of schema migrations. Each is applied exactly once,
// in id order, inside a single transaction, and the highest applied id is stored
// in `PRAGMA user_version`. Opening an up-to-date database applies nothing.
//
// RULES for later tickets:
//   - Never edit or reorder an existing migration. Add a new one with the next id.
//   - `id` is a plain incrementing integer (1, 2, 3, …).
//   - `up` is any number of SQL statements; `better-sqlite3`'s `db.exec` runs them.

export interface Migration {
  id: number
  name: string
  up: string
}

/**
 * Migration 001 — the schema everything after this ticket builds on.
 *
 * `sounds` and `search_cache` are used now (search cache + persisted metadata).
 * The remaining tables are created empty so that tickets 08/10/11/12/16 and the
 * auth tickets only ever ADD columns or indexes — never introduce a table into a
 * database that already has rows in it.
 */
const m001: Migration = {
  id: 1,
  name: 'initial-schema',
  up: /* sql */ `
    -- Freesound metadata mirrored locally. Columns mirror the core \`Sound\` type
    -- 1:1. Present for every Sound the app has seen — search result, Staged, or
    -- Library. Later tickets reuse the same upsert.
    CREATE TABLE sounds (
      id             INTEGER PRIMARY KEY,
      name           TEXT    NOT NULL,
      username       TEXT    NOT NULL,
      license_url    TEXT    NOT NULL,
      license_name   TEXT    NOT NULL,
      duration       REAL    NOT NULL,
      tags           TEXT    NOT NULL,          -- JSON array of strings
      filesize       INTEGER NOT NULL,
      type           TEXT    NOT NULL,
      samplerate     INTEGER NOT NULL,
      channels       INTEGER NOT NULL,
      bitdepth       INTEGER NOT NULL,
      preview_hq_mp3 TEXT    NOT NULL,
      preview_lq_mp3 TEXT    NOT NULL,
      preview_hq_ogg TEXT    NOT NULL,
      preview_lq_ogg TEXT    NOT NULL,
      waveform_m     TEXT    NOT NULL,
      waveform_l     TEXT    NOT NULL,
      spectral_m     TEXT,
      spectral_l     TEXT,
      url            TEXT    NOT NULL,
      download_count INTEGER NOT NULL,
      avg_rating     REAL    NOT NULL,
      created        TEXT    NOT NULL,
      first_seen_at  INTEGER NOT NULL,          -- epoch ms, set on first insert
      updated_at     INTEGER NOT NULL           -- epoch ms, bumped on every upsert
    );

    -- One row per fully-normalized search request. Kept INDEFINITELY (spec:
    -- "cached indefinitely") — there is no TTL and no eviction here.
    --
    -- \`key\` is a hash of \`params_json\`. \`params_json\` is the canonical JSON of
    -- EVERY parameter that affects results (query text, page, pageSize, and — from
    -- ticket 15 — sort and filters). Because the key is derived from an open-ended
    -- JSON object, ticket 15 can add sort/filter fields to the key WITHOUT a
    -- migration: a request that carries new params simply hashes to a new key and
    -- old rows keep serving the unfiltered query.
    CREATE TABLE search_cache (
      key         TEXT    PRIMARY KEY,          -- sha256(params_json), hex
      params_json TEXT    NOT NULL,             -- canonical JSON, keys sorted
      sound_ids   TEXT    NOT NULL,             -- JSON array of sound ids, in order
      total_count INTEGER NOT NULL,
      has_more    INTEGER NOT NULL,             -- 0 | 1
      fetched_at  INTEGER NOT NULL              -- epoch ms
    );

    -- ---- created empty now; populated by later tickets ---------------------

    -- ticket 11: the user's intent to KEEP a Sound, plus their overlay.
    CREATE TABLE library_entries (
      sound_id    INTEGER PRIMARY KEY REFERENCES sounds(id) ON DELETE CASCADE,
      custom_name TEXT,
      custom_tags TEXT,                         -- JSON array of strings
      saved_at    INTEGER NOT NULL
    );

    -- ticket 16: user-named, unordered sets of Library Sounds.
    CREATE TABLE collections (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE collection_members (
      collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      sound_id      INTEGER NOT NULL REFERENCES sounds(id) ON DELETE CASCADE,
      added_at      INTEGER NOT NULL,
      PRIMARY KEY (collection_id, sound_id)
    );

    -- ticket 10: LRU bookkeeping for the staging byte budget.
    CREATE TABLE staged_entries (
      sound_id       INTEGER PRIMARY KEY REFERENCES sounds(id) ON DELETE CASCADE,
      byte_size      INTEGER NOT NULL,
      last_access_at INTEGER NOT NULL
    );

    -- ticket 12: computed waveform peak data, one blob per Sound.
    CREATE TABLE peaks (
      sound_id     INTEGER PRIMARY KEY REFERENCES sounds(id) ON DELETE CASCADE,
      sample_rate  INTEGER NOT NULL,
      bucket_count INTEGER NOT NULL,
      data         BLOB    NOT NULL,
      computed_at  INTEGER NOT NULL
    );

    -- ticket 07: the single encrypted OAuth blob + access-token expiry.
    CREATE TABLE auth (
      id                   INTEGER PRIMARY KEY CHECK (id = 1),
      refresh_token_enc    BLOB,
      access_token_expires INTEGER
    );
  `,
}

/** The migration list, in application order. Append only. */
export const MIGRATIONS: readonly Migration[] = [m001]
