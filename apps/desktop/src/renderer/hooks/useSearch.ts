// Owns a query's lifecycle in the renderer: the first page and the "load more"
// append path. Debounce and the result cache both live in the CORE now (ticket
// 05) — this hook calls `window.core.searchDebounced` on every change and simply
// renders whatever resolves. It only has to:
//   - show a loading state while a query is in flight
//   - keep an empty result set distinct from an error, and throttling distinct
//     from a generic failure
//   - append later pages without duplicating rows
//   - never run two page requests for the same query at once
//   - drop responses for a query the user has already moved on from

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Sound } from '../../core/types'

export type SearchStatus = 'idle' | 'loading' | 'ok' | 'error'

export interface SearchError {
  kind: 'throttled' | 'network' | 'generic'
  message: string
  /** Seconds until retry is allowed — only for `kind: 'throttled'`. */
  retryAfter: number | null
}

export interface UseSearch {
  status: SearchStatus
  error: SearchError | null
  sounds: Sound[]
  totalCount: number
  hasMore: boolean
  loadingMore: boolean
  loadMore: () => void
}

/** Turn an unknown thrown value into a classified, renderable error. */
function classifyError(e: unknown): SearchError {
  const name = e instanceof Error ? e.name : ''
  const message = e instanceof Error ? e.message : String(e)

  // `name` survives IPC serialization; `retryAfter` may not, so fall back to the
  // message, which always carries the number.
  const looksThrottled = name === 'ThrottledError' || /rate-limited/i.test(message)
  if (looksThrottled) {
    const anyE = e as { retryAfter?: unknown }
    const fromField =
      typeof anyE.retryAfter === 'number' ? anyE.retryAfter : null
    const fromMsg = message.match(/(\d+)\s*s/)
    const retryAfter = fromField ?? (fromMsg ? Number(fromMsg[1]) : null)
    return { kind: 'throttled', message, retryAfter }
  }

  if (name === 'NetworkError') return { kind: 'network', message, retryAfter: null }
  return { kind: 'generic', message, retryAfter: null }
}

export function useSearch(query: string): UseSearch {
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [error, setError] = useState<SearchError | null>(null)
  const [sounds, setSounds] = useState<Sound[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const activeQuery = useRef('')
  const pageRef = useRef(1)
  const inFlightPage = useRef<number | null>(null)

  useEffect(() => {
    const q = query.trim()
    activeQuery.current = q

    if (q === '') {
      setStatus('idle')
      setError(null)
      setSounds([])
      setTotalCount(0)
      setHasMore(false)
      setLoadingMore(false)
      pageRef.current = 1
      inFlightPage.current = null
      return
    }

    setStatus('loading')
    setError(null)
    inFlightPage.current = 1

    window.core
      .searchDebounced(q, { page: 1 })
      .then((r) => {
        if (activeQuery.current !== q) return
        setSounds(r.sounds)
        setTotalCount(r.totalCount)
        setHasMore(r.hasMore)
        pageRef.current = 1
        setStatus('ok')
      })
      .catch((e: unknown) => {
        if (activeQuery.current !== q) return
        setError(classifyError(e))
        setSounds([])
        setTotalCount(0)
        setHasMore(false)
        setStatus('error')
      })
      .finally(() => {
        if (inFlightPage.current === 1) inFlightPage.current = null
      })
  }, [query])

  const loadMore = useCallback(() => {
    const q = activeQuery.current
    if (q === '' || !hasMore || loadingMore || inFlightPage.current !== null) return

    const next = pageRef.current + 1
    inFlightPage.current = next
    setLoadingMore(true)

    window.core
      .search(q, { page: next })
      .then((r) => {
        if (activeQuery.current !== q) return
        setSounds((prev) => {
          const seen = new Set(prev.map((s) => s.id))
          return [...prev, ...r.sounds.filter((s) => !seen.has(s.id))]
        })
        setTotalCount(r.totalCount)
        setHasMore(r.hasMore)
        pageRef.current = next
      })
      .catch(() => {
        if (activeQuery.current !== q) return
        setHasMore(false)
      })
      .finally(() => {
        if (inFlightPage.current === next) inFlightPage.current = null
        setLoadingMore(false)
      })
  }, [hasMore, loadingMore])

  return { status, error, sounds, totalCount, hasMore, loadingMore, loadMore }
}
