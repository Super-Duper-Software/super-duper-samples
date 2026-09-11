import { mapRawSound } from '../gateway/mapRawSound'
import type { FreesoundGateway, RawSearchPage } from '../gateway/index'
import type {
  SearchFilter,
  SearchOptions,
  SearchResult,
  SearchSort,
} from '../types'
import {
  DEFAULT_RETRY_AFTER_SECONDS,
  GatewayError,
  NotSignedInError,
  ThrottledError,
} from '../errors'
import type { Logger } from '../logging/logger'
import { classifyError } from '../classifyError'
import type { ErrorTelemetrySink } from '../telemetry'
import type { DB } from '../db/index'
import { getSoundsByIds, upsertSounds } from '../db/sounds'
import {
  cacheKey,
  readSearchCache,
  writeSearchCache,
  type SearchCacheParams,
} from '../db/searchCache'
import type { AuthController } from '../auth/index'
import { createSearchController } from './searchController'
import { normalizeFilter, normalizeSort } from './normalise'

const DEFAULT_PAGE_SIZE = 15

export interface SearchServiceDeps {
  db: DB
  gateway: FreesoundGateway
  auth: AuthController
  logger: Logger
  debounceMs: number
  /** Optional. Records an anonymous `search_failed` category count on a gateway failure. */
  telemetry?: ErrorTelemetrySink
}

export interface SearchService {
  /** Search through the SQLite cache; a miss costs one gateway call and prefetches the next page. */
  search(query: string, opts?: SearchOptions): Promise<SearchResult>
  /** Debounced `search` — rapid calls collapse into one request for the trailing query. */
  searchDebounced(query: string, opts?: SearchOptions): Promise<SearchResult>
  close(): void
}

/** Create the cache-backed, authenticated search service used by the core. */
export function createSearchService({
  db,
  gateway,
  auth,
  logger,
  debounceMs,
  telemetry,
}: SearchServiceDeps): SearchService {
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

  /** Fetch one result page, persist its sounds and cache metadata, and report failures. */
  async function fetchAndStore(
    query: string,
    page: number,
    pageSize: number,
    sort: SearchSort | undefined,
    filter: SearchFilter | undefined,
    ck: ReturnType<typeof cacheKey>,
    allowPrefetch: boolean,
  ): Promise<SearchResult> {
    let raw: RawSearchPage
    try {
      raw = await auth.authorized((accessToken) =>
        gateway.search(
          {
            query: query.trim(),
            page,
            pageSize,
            ...(sort ? { sort } : {}),
            ...(filter ? { filter } : {}),
          },
          accessToken,
        ),
      )
    } catch (err) {
      const typed = asTypedError(err)
      logger.warn('search failed', {
        query: query.trim(),
        page,
        error: typed instanceof Error ? typed.name : String(typed),
        message: typed instanceof Error ? typed.message : undefined,
      })
      telemetry?.report({
        code: 'search_failed',
        subReason: classifyError(typed).kind,
      })
      throw typed
    }

    const sounds = raw.results.map(mapRawSound)
    const hasMore = sounds.length > 0 && page * pageSize < raw.count

    upsertSounds(db, sounds)
    writeSearchCache(db, ck, {
      soundIds: sounds.map((s) => s.id),
      totalCount: raw.count,
      hasMore,
    })

    if (allowPrefetch && hasMore) {
      prefetchNextPage(query, page, pageSize, sort, filter)
    }

    return { query, totalCount: raw.count, page, pageSize, sounds, hasMore }
  }

  function runSearch(
    query: string,
    opts: SearchOptions | undefined,
    allowPrefetch: boolean,
  ): Promise<SearchResult> {
    const page = opts?.page ?? 1
    const pageSize = opts?.pageSize ?? DEFAULT_PAGE_SIZE
    const sort = normalizeSort(opts?.sort)
    const filter = normalizeFilter(opts?.filter)
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

    if (auth.getState().status !== 'signedIn') {
      return Promise.reject(new NotSignedInError())
    }

    const params: SearchCacheParams = {
      query: trimmed,
      page,
      pageSize,
      sort,
      filter,
    }
    const ck = cacheKey(params)

    const cached = readSearchCache(db, ck.key)
    if (cached) return Promise.resolve(fromCache(query, page, pageSize, cached))

    const existing = inFlight.get(ck.key)
    if (existing) return existing

    const p = fetchAndStore(
      query,
      page,
      pageSize,
      sort,
      filter,
      ck,
      allowPrefetch,
    ).finally(() => {
      inFlight.delete(ck.key)
    })
    inFlight.set(ck.key, p)
    return p
  }

  function prefetchNextPage(
    query: string,
    page: number,
    pageSize: number,
    sort: SearchSort | undefined,
    filter: SearchFilter | undefined,
  ): void {
    const { key } = cacheKey({
      query: query.trim(),
      page: page + 1,
      pageSize,
      sort,
      filter,
    })
    if (inFlight.has(key) || readSearchCache(db, key)) return
    void runSearch(
      query,
      { page: page + 1, pageSize, sort, filter },
      false,
    ).catch(() => {})
  }

  const controller = createSearchController(
    { search: (q, o) => runSearch(q, o, true) },
    { debounceMs },
  )

  return {
    search: (query, opts) => runSearch(query, opts, true),
    searchDebounced: (query, opts) => controller.query(query, opts),
    close: () => controller.dispose(),
  }
}

/** Map a 429 gateway error to the distinct `ThrottledError`; pass anything else through. */
function asTypedError(err: unknown): unknown {
  if (err instanceof GatewayError && err.status === 429) {
    return new ThrottledError(err.retryAfter ?? DEFAULT_RETRY_AFTER_SECONDS)
  }
  return err
}
