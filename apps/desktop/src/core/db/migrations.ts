export interface Migration {
  id: number
  name: string
  up: string
}

/**
 * The base schema. Every table is created here, even those populated later, so
 * subsequent migrations only ever ADD columns or indexes.
 */
const m001: Migration = {
  id: 1,
  name: 'initial-schema',
  up: /* sql */ `
    -- Freesound metadata mirrored locally, one row per Sound the app has seen.
    -- Columns mirror the core \`Sound\` type 1:1.
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

    -- One row per fully-normalized search request. Kept indefinitely: no TTL,
    -- no eviction. \`key\` hashes \`params_json\`, the canonical JSON of every
    -- parameter that affects results, so new sort/filter fields can join the key
    -- without a migration.
    CREATE TABLE search_cache (
      key         TEXT    PRIMARY KEY,          -- sha256(params_json), hex
      params_json TEXT    NOT NULL,             -- canonical JSON, keys sorted
      sound_ids   TEXT    NOT NULL,             -- JSON array of sound ids, in order
      total_count INTEGER NOT NULL,
      has_more    INTEGER NOT NULL,             -- 0 | 1
      fetched_at  INTEGER NOT NULL              -- epoch ms
    );

    -- ---- created empty; populated once the features that own them land ----

    -- the user's intent to KEEP a Sound, plus their overlay.
    CREATE TABLE library_entries (
      sound_id    INTEGER PRIMARY KEY REFERENCES sounds(id) ON DELETE CASCADE,
      custom_name TEXT,
      custom_tags TEXT,                         -- JSON array of strings
      saved_at    INTEGER NOT NULL
    );

    -- user-named, unordered sets of Library Sounds.
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

    -- LRU bookkeeping for the staging byte budget.
    CREATE TABLE staged_entries (
      sound_id       INTEGER PRIMARY KEY REFERENCES sounds(id) ON DELETE CASCADE,
      byte_size      INTEGER NOT NULL,
      last_access_at INTEGER NOT NULL
    );

    -- computed waveform peak data, one blob per Sound.
    CREATE TABLE peaks (
      sound_id     INTEGER PRIMARY KEY REFERENCES sounds(id) ON DELETE CASCADE,
      sample_rate  INTEGER NOT NULL,
      bucket_count INTEGER NOT NULL,
      data         BLOB    NOT NULL,
      computed_at  INTEGER NOT NULL
    );

    -- the single encrypted OAuth blob + access-token expiry.
    CREATE TABLE auth (
      id                   INTEGER PRIMARY KEY CHECK (id = 1),
      refresh_token_enc    BLOB,
      access_token_expires INTEGER
    );
  `,
}

/**
 * Migration 002 — staging.
 *
 * Two nullable columns on `staged_entries`, so eviction can act without
 * re-deriving paths:
 *
 *   - `path`       — absolute path to the staged Original in the content store.
 *   - `created_at` — epoch ms the Original first landed. `last_access_at` is
 *                    bumped on every re-audition; `created_at` is not.
 *
 * `app_meta` is a key/value table for one-off app flags. `staging_consent_at`
 * holds when the user acknowledged that auditioning downloads sounds against
 * their Freesound record; until it is set, auditioning does NOT stage.
 */
const m002: Migration = {
  id: 2,
  name: 'staging-content-store',
  up: /* sql */ `
    ALTER TABLE staged_entries ADD COLUMN path       TEXT;
    ALTER TABLE staged_entries ADD COLUMN created_at INTEGER;

    CREATE TABLE app_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `,
}

/**
 * Migration 003 — the rolling download log.
 *
 * Every time an Original is fetched from Freesound it is recorded here, one row
 * per download, with the epoch-ms instant it completed. Freesound caps a user at
 * 2,000 Original downloads per rolling 24 h; the app counts the rows newer than
 * `now - 24h` to show "N downloads left". Rows are never pruned here (a cheap
 * background sweep can trim them later); the count query is bounded by the
 * `downloaded_at` index.
 */
const m003: Migration = {
  id: 3,
  name: 'download-log',
  up: /* sql */ `
    CREATE TABLE download_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      sound_id      INTEGER NOT NULL,
      downloaded_at INTEGER NOT NULL           -- epoch ms the Original landed
    );

    CREATE INDEX idx_download_log_at ON download_log (downloaded_at);
  `,
}

/**
 * Migration 004 — Edits (ADR-0005).
 *
 * An Edit is an ordinary `sounds` row with a negative `id` (Freesound ids are
 * always positive, so the id spaces never collide), plus three nullable columns:
 *
 *   - `derived_from` — the parent Sound's id; NULL for every mirrored Sound.
 *   - `edit_spec`    — the trim + encode spec (JSON), as passed to `createEdit`.
 *   - `local_path`   — the Edit's file. A real Sound's Original is derivable as
 *     `<id>.<ext>`, but an Edit's file is named from its PARENT id plus a human
 *     suffix, so the path is stored rather than derived.
 *
 * Existing rows read back NULL in all three, which is exactly "not an Edit".
 */
const m004: Migration = {
  id: 4,
  name: 'edits',
  up: /* sql */ `
    ALTER TABLE sounds ADD COLUMN derived_from INTEGER;
    ALTER TABLE sounds ADD COLUMN edit_spec    TEXT;
    ALTER TABLE sounds ADD COLUMN local_path   TEXT;
  `,
}

/**
 * Migration 005 — retire stale "undecodable" peak sentinels.
 *
 * A compressed Original (FLAC, MP3, OGG) used to fail the WAV/AIFF-only decoder
 * and write a sentinel row (`bucket_count = 0`) that short-circuits
 * `requestPeaks` forever. Those files now have a scratch-PCM render path, so
 * drop every sentinel to let each recompute once; a genuinely undecodable file
 * simply writes the sentinel again. Real peak rows are untouched.
 */
const m005: Migration = {
  id: 5,
  name: 'clear-undecodable-peak-sentinels',
  up: /* sql */ `
    DELETE FROM peaks WHERE bucket_count = 0;
  `,
}

/** The migration list, in application order. Append only. */
export const MIGRATIONS: readonly Migration[] = [m001, m002, m003, m004, m005]
