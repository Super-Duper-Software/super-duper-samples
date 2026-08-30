// Owns a query's lifecycle in the renderer: debounce, the first page, and the
// "load more" append path. Deliberately minimal — ticket 05 replaces this with
// the SQLite-backed cache + prefetch. It only has to:
//   - show a loading state while a query is in flight
//   - keep an empty result set distinct from an error
//   - append later pages without duplicating rows
//   - never run two page requests for the same query at once

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Sound } from '../../core/types'

export type SearchStatus = 'idle' | 'loading' | 'ok' | 'error'

export interface UseSearch {
  status: SearchStatus
  error: string | null
  sounds: Sound[]
  totalCount: number
  /** A further page exists and can be requested with `loadMore`. */
  hasMore: boolean
  /** A `loadMore` request is currently in flight (first page uses `status`). */
  loadingMore: boolean
  /** Append the next page. No-op if nothing more, already loading, or idle. */
  loadMore: () => void
}

const DEBOUNCE_MS = 250

export function useSearch(query: string): UseSearch {
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [sounds, setSounds] = useState<Sound[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  // The query this hook currently considers authoritative. Late responses for a
  // superseded query are dropped by comparing against it.
  const activeQuery = useRef('')
  // Highest page successfully appended so far.
  const pageRef = useRef(1)
  // The page number of the request in flight, or null. Guards against firing a
  // duplicate request for the same page on rapid scroll.
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

    const timer = setTimeout(() => {
      inFlightPage.current = 1
      window.core
        .search(q, { page: 1 })
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
          setError(e instanceof Error ? e.message : String(e))
          setSounds([])
          setTotalCount(0)
          setHasMore(false)
          setStatus('error')
        })
        .finally(() => {
          if (inFlightPage.current === 1) inFlightPage.current = null
        })
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
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
        // Keep what we have; stop trying to paginate further.
        setHasMore(false)
      })
      .finally(() => {
        if (inFlightPage.current === next) inFlightPage.current = null
        setLoadingMore(false)
      })
  }, [hasMore, loadingMore])

  return { status, error, sounds, totalCount, hasMore, loadingMore, loadMore }
}
