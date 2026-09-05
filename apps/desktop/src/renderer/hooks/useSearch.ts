import { useCallback, useEffect, useRef, useState } from 'react'
import type { SearchFilter, SearchSort, Sound } from '../../core/types'

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

export function useSearch(
  query: string,
  sort: SearchSort = 'relevance',
  filter: SearchFilter = {},
  /** Wait until the persisted sort/filter prefs have loaded. */
  ready = true,
): UseSearch {
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [error, setError] = useState<SearchError | null>(null)
  const [sounds, setSounds] = useState<Sound[]>([])
  const soundsRef = useRef<Sound[]>([])
  soundsRef.current = sounds
  const [totalCount, setTotalCount] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const activeQuery = useRef('')
  const pageRef = useRef(1)
  const inFlightPage = useRef<number | null>(null)

  const optsRef = useRef<{ sort: SearchSort; filter: SearchFilter }>({ sort, filter })
  optsRef.current = { sort, filter }

  const filterKey = JSON.stringify(filter)

  useEffect(() => {
    if (!ready) return
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

    setStatus(soundsRef.current.length > 0 ? 'ok' : 'loading')
    setError(null)
    inFlightPage.current = 1

    window.core
      .searchDebounced(q, { page: 1, sort, filter })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sort, filterKey, ready])

  const loadMore = useCallback(() => {
    const q = activeQuery.current
    if (q === '' || !hasMore || loadingMore || inFlightPage.current !== null) return

    const next = pageRef.current + 1
    inFlightPage.current = next
    setLoadingMore(true)

    window.core
      .search(q, {
        page: next,
        sort: optsRef.current.sort,
        filter: optsRef.current.filter,
      })
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
