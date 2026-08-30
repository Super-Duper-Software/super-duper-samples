// `search_cache` table access + the cache-key scheme.
//
// The key is `sha256(canonicalJson(params))`. `params` is an open-ended object
// holding EVERY value that affects which Sounds a page contains. Today that is
// `{ query, page, pageSize }`; ticket 15 adds `{ sort, filters: {...} }`. Because
// the key is a hash of a canonical serialization of the whole object, new fields
// change the key with NO migration — an unfiltered query and the same query with
// a filter simply land on different rows.
//
// Canonicalization sorts object keys recursively and drops `undefined`, so the
// key is stable regardless of the order params were built in.

import { createHash } from 'node:crypto'
import type { DB } from './index'

/** Everything that affects a result page. Extend freely — see file header. */
export interface SearchCacheParams {
  query: string
  page: number
  pageSize: number
  // ticket 15 will add: sort?: string; filters?: Record<string, unknown>
  [k: string]: unknown
}

/** Deterministic JSON: object keys sorted at every level, `undefined` removed. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value))
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(src).sort()) {
      if (src[k] === undefined) continue
      out[k] = sortDeep(src[k])
    }
    return out
  }
  return value
}

export interface CacheKey {
  key: string
  paramsJson: string
}

/** Compose the cache key + its canonical params blob from a params object. */
export function cacheKey(params: SearchCacheParams): CacheKey {
  const paramsJson = canonicalJson(params)
  const key = createHash('sha256').update(paramsJson).digest('hex')
  return { key, paramsJson }
}

export interface CachedPage {
  soundIds: number[]
  totalCount: number
  hasMore: boolean
  fetchedAt: number
}

interface CacheRow {
  sound_ids: string
  total_count: number
  has_more: number
  fetched_at: number
}

/** Look up a cached page by key. `undefined` on a miss. */
export function readSearchCache(db: DB, key: string): CachedPage | undefined {
  const row = db
    .prepare(
      'SELECT sound_ids, total_count, has_more, fetched_at FROM search_cache WHERE key = ?',
    )
    .get(key) as CacheRow | undefined
  if (!row) return undefined
  return {
    soundIds: JSON.parse(row.sound_ids) as number[],
    totalCount: row.total_count,
    hasMore: row.has_more === 1,
    fetchedAt: row.fetched_at,
  }
}

/** Write (or replace) a cached page. Kept indefinitely — no TTL, no eviction. */
export function writeSearchCache(
  db: DB,
  { key, paramsJson }: CacheKey,
  page: { soundIds: readonly number[]; totalCount: number; hasMore: boolean },
): void {
  db.prepare(
    `INSERT INTO search_cache (key, params_json, sound_ids, total_count, has_more, fetched_at)
     VALUES (@key, @params_json, @sound_ids, @total_count, @has_more, @fetched_at)
     ON CONFLICT(key) DO UPDATE SET
       params_json = excluded.params_json,
       sound_ids   = excluded.sound_ids,
       total_count = excluded.total_count,
       has_more    = excluded.has_more,
       fetched_at  = excluded.fetched_at`,
  ).run({
    key,
    params_json: paramsJson,
    sound_ids: JSON.stringify([...page.soundIds]),
    total_count: page.totalCount,
    has_more: page.hasMore ? 1 : 0,
    fetched_at: Date.now(),
  })
}
