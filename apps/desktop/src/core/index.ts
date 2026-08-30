// The core: a plain Node module holding ALL behaviour. NO `electron` import may
// ever appear anywhere under src/core/ (enforced by test/core.no-electron.test.ts).
//
// `createCore` returns an object whose methods ARE the command API. The
// contextBridge preload surface forwards those methods verbatim — the core's
// command API *is* the IPC contract (CONVENTIONS.md, spec 0001).

import { mapRawSound } from './gateway/mapRawSound'
import type { FreesoundGateway } from './gateway/index'
import type { SearchOptions, SearchResult } from './types'

export type { FreesoundGateway } from './gateway/index'
export * from './types'
export { GatewayError, NetworkError, NotImplemented } from './errors'

const DEFAULT_PAGE_SIZE = 15

export interface CoreDeps {
  /** The sole network boundary. */
  gateway: FreesoundGateway
  /** App data directory (Electron `userData` in production; a temp dir in tests). */
  dataDir: string
  /** Path to the SQLite database file. The DB itself arrives in ticket 05. */
  dbPath: string
}

/** The command API. Later tickets add methods here; the bridge forwards them all. */
export interface Core {
  /**
   * Full-text search against Freesound. One gateway call yields a complete page —
   * every field a result row needs is requested up front, so no per-Sound detail
   * request is ever made.
   *
   * An empty result set returns `{ totalCount: 0, sounds: [] }`. A failure throws
   * a typed `GatewayError` / `NetworkError` — it is never an empty list.
   */
  search(query: string, opts?: SearchOptions): Promise<SearchResult>
}

export function createCore(deps: CoreDeps): Core {
  const { gateway } = deps

  return {
    async search(query, opts): Promise<SearchResult> {
      const page = opts?.page ?? 1
      const pageSize = opts?.pageSize ?? DEFAULT_PAGE_SIZE
      const trimmed = query.trim()

      if (trimmed === '') {
        return { query, totalCount: 0, page, pageSize, sounds: [] }
      }

      const raw = await gateway.search({ query: trimmed, page, pageSize })

      return {
        query,
        totalCount: raw.count,
        page,
        pageSize,
        sounds: raw.results.map(mapRawSound),
      }
    },
  }
}
