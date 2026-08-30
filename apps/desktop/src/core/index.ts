// The core: a plain Node module holding ALL behaviour. NO `electron` import may
// ever appear anywhere under src/core/ (enforced by test/core.no-electron.test.ts).
//
// `createCore` returns an object whose methods ARE the command API. The
// contextBridge preload surface forwards those methods verbatim — the core's
// command API *is* the IPC contract (CONVENTIONS.md, spec 0001).

import { mapRawSound } from './gateway/mapRawSound'
import type { FreesoundGateway, RawSearchPage } from './gateway/index'
import type { SearchOptions, SearchResult } from './types'
import {
  DEFAULT_RETRY_AFTER_SECONDS,
  GatewayError,
  ThrottledError,
} from './errors'
import { openDb, type DB } from './db/index'
import { getSoundsByIds, upsertSounds } from './db/sounds'
import {
  cacheKey,
  readSearchCache,
  writeSearchCache,
  type SearchCacheParams,
} from './db/searchCache'
import { createSearchController, type SearchController } from './searchController'

export type { FreesoundGateway } from './gateway/index'
export * from './types'
export {
  GatewayError,
  NetworkError,
  NotImplemented,
  ThrottledError,
  DEFAULT_RETRY_AFTER_SECONDS,
} from './errors'

const DEFAULT_PAGE_SIZE = 15
const DEBOUNCE_MS = 250

export interface CoreDeps {
  /** The sole network boundary. */
  gateway: FreesoundGateway
  /** App data directory (Electron `userData` in production; a temp dir in tests). */
  dataDir: string
  /** Path to the SQLite database file. Opened here — never on the renderer thread. */
  dbPath: string
  /** Debounce window for `searchDebounced`, ms. Defaults to 250. Tests shrink it. */
  debounceMs?: number
}

/** The command API. Later tickets add methods here; the bridge forwards them all. */
export interface Core {
  /**
   * Full-text search against Freesound, through the SQLite search cache.
   *
   * A cache HIT (same fully-normalized query — text, page, pageSize, and any
   * future sort/filter params) is served entirely from the DB with ZERO gateway
   * calls, which makes back-navigation and repeated queries free.
   *
   * A cache MISS costs exactly one gateway call: every returned `Sound` is
   * persisted into `sounds`, the page's id list + `totalCount` + `hasMore` is
   * written to `search_cache` (kept indefinitely), and the NEXT page is
   * prefetched in the background so a scroll never stalls.
   *
   * An empty result set returns `{ totalCount: 0, sounds: [] }`. A failure throws
   * a typed error — `ThrottledError` (429, with `retryAfter` seconds),
   * `GatewayError`, or `NetworkError` — never an empty list, and never a bogus
   * empty cache row.
   */
  search(query: string, opts?: SearchOptions): Promise<SearchResult>

  /**
   * Debounced `search`: rapid calls within the debounce window collapse into a
   * single gateway request for the trailing query. The renderer calls this on
   * every keystroke; the debounce lives here so it is tested at the core seam.
   */
  searchDebounced(query: string, opts?: SearchOptions): Promise<SearchResult>

  /** Release the database handle and cancel any pending debounced call. */
  close(): void
}

export function createCore(deps: CoreDeps): Core {
  const { gateway, dbPath, debounceMs = DEBOUNCE_MS } = deps
  const db: DB = openDb(dbPath)

  // Keyed by cache key. Holds BOTH foreground searches and background prefetches,
  // so a real request for a page already being prefetched attaches to the same
  // promise instead of issuing a second gateway call — and duplicate prefetches
  // are impossible.
  const inFlight = new Map<string, Promise<SearchResult>>()

  function fromCache(
    query: string,
    page: number,
    pageSize: number,
    cached: NonNullable<ReturnType<typeof readSearchCache>>,
  ): SearchResult {
    return {
      query,
      totalCount: cached.totalCount,
      page,
      pageSize,
      sounds: getSoundsByIds(db, cached.soundIds),
      hasMore: cached.hasMore,
    }
  }

  async function fetchAndStore(
    query: string,
    page: number,
    pageSize: number,
    ck: ReturnType<typeof cacheKey>,
    allowPrefetch: boolean,
  ): Promise<SearchResult> {
    let raw: RawSearchPage
    try {
      raw = await gateway.search({ query: query.trim(), page, pageSize })
    } catch (err) {
      // A failure on a MISS propagates as a typed error and writes NOTHING —
      // no empty cache row, so a later retry still reaches the gateway.
      throw asTypedError(err)
    }

    const sounds = raw.results.map(mapRawSound)
    const hasMore = sounds.length > 0 && page * pageSize < raw.count

    upsertSounds(db, sounds)
    writeSearchCache(db, ck, {
      soundIds: sounds.map((s) => s.id),
      totalCount: raw.count,
      hasMore,
    })

    if (allowPrefetch && hasMore) prefetchNextPage(query, page, pageSize)

    return { query, totalCount: raw.count, page, pageSize, sounds, hasMore }
  }

  function runSearch(
    query: string,
    opts: SearchOptions | undefined,
    allowPrefetch: boolean,
  ): Promise<SearchResult> {
    const page = opts?.page ?? 1
    const pageSize = opts?.pageSize ?? DEFAULT_PAGE_SIZE
    const trimmed = query.trim()

    if (trimmed === '') {
      return Promise.resolve({
        query,
        totalCount: 0,
        page,
        pageSize,
        sounds: [],
        hasMore: false,
      })
    }

    const params: SearchCacheParams = { query: trimmed, page, pageSize }
    const ck = cacheKey(params)

    const cached = readSearchCache(db, ck.key)
    if (cached) return Promise.resolve(fromCache(query, page, pageSize, cached))

    const existing = inFlight.get(ck.key)
    if (existing) return existing

    const p = fetchAndStore(query, page, pageSize, ck, allowPrefetch).finally(
      () => {
        inFlight.delete(ck.key)
      },
    )
    inFlight.set(ck.key, p)
    return p
  }

  function prefetchNextPage(
    query: string,
    page: number,
    pageSize: number,
  ): void {
    const nextParams: SearchCacheParams = {
      query: query.trim(),
      page: page + 1,
      pageSize,
    }
    const { key } = cacheKey(nextParams)
    if (inFlight.has(key) || readSearchCache(db, key)) return
    // Fire-and-forget; errors are swallowed. `allowPrefetch: false` so prefetch
    // never chains into prefetching page+2, page+3, …
    void runSearch(query, { page: page + 1, pageSize }, false).catch(() => {})
  }

  const controller: SearchController = createSearchController(
    { search: (q, o) => runSearch(q, o, true) },
    { debounceMs },
  )

  return {
    search: (query, opts) => runSearch(query, opts, true),
    searchDebounced: (query, opts) => controller.query(query, opts),
    close: () => {
      controller.dispose()
      db.close()
    },
  }
}

/** Map a 429 gateway error to the distinct `ThrottledError`; pass anything else through. */
function asTypedError(err: unknown): unknown {
  if (err instanceof GatewayError && err.status === 429) {
    return new ThrottledError(err.retryAfter ?? DEFAULT_RETRY_AFTER_SECONDS)
  }
  return err
}
