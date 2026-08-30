// Debounce, at the core seam.
//
// The renderer fires a query on every keystroke. Rather than each layer growing
// its own timer, the debounce lives here — one place, unit-tested against the
// fake gateway, no Electron and no renderer test needed. The renderer calls
// `core.searchDebounced(...)` (which delegates to a single controller instance)
// and simply renders whatever resolves.
//
// Semantics: within the debounce window only the LAST `query(text, opts)` call
// reaches `core.search`. Every pending `query()` promise from that window
// resolves with that one result (or rejects with its error) — callers that were
// superseded still get an answer, and the renderer drops stale ones by comparing
// the query string it cares about.

import type { SearchOptions, SearchResult } from './types'

export interface SearchController {
  /** Debounced search. Collapses rapid calls; resolves all with the trailing result. */
  query(text: string, opts?: SearchOptions): Promise<SearchResult>
  /** Cancel a pending debounced call (pending promises reject). For teardown. */
  dispose(): void
}

interface Deferred {
  resolve: (r: SearchResult) => void
  reject: (e: unknown) => void
}

export interface SearchControllerDeps {
  search(query: string, opts?: SearchOptions): Promise<SearchResult>
}

export function createSearchController(
  core: SearchControllerDeps,
  { debounceMs = 250 }: { debounceMs?: number } = {},
): SearchController {
  let timer: ReturnType<typeof setTimeout> | undefined
  let latest: { text: string; opts?: SearchOptions } | undefined
  let waiters: Deferred[] = []

  function fire(): void {
    timer = undefined
    const call = latest
    const pending = waiters
    latest = undefined
    waiters = []
    if (!call) return

    core.search(call.text, call.opts).then(
      (r) => {
        for (const w of pending) w.resolve(r)
      },
      (e: unknown) => {
        for (const w of pending) w.reject(e)
      },
    )
  }

  return {
    query(text, opts) {
      latest = { text, opts }
      if (timer) clearTimeout(timer)
      timer = setTimeout(fire, debounceMs)
      return new Promise<SearchResult>((resolve, reject) => {
        waiters.push({ resolve, reject })
      })
    },
    dispose() {
      if (timer) clearTimeout(timer)
      timer = undefined
      latest = undefined
      const pending = waiters
      waiters = []
      for (const w of pending) w.reject(new Error('search controller disposed'))
    },
  }
}
