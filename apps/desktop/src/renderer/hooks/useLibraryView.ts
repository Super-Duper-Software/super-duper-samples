// Loads the Library list for the Library tab (tickets 11 + 13).
//
// Unlike `useSearch` there is no paging and no gateway: `window.core.filterLibrary`
// is served entirely from the local database, so this works offline and while
// signed out and feels instant. It re-fetches when the tab becomes active, when
// the sort direction changes, when the Library filter changes, and whenever
// `useLibrary.revision` bumps (a save / remove / rename / retag happened).

import { useEffect, useState } from 'react'
import type { LibraryFilter, LibrarySound } from '../../preload'
import { useLibrary } from '../store/useLibrary'

export type LibrarySortDir = 'asc' | 'desc'
export type LibraryViewStatus = 'idle' | 'loading' | 'ok' | 'error'

export interface UseLibraryView {
  sounds: LibrarySound[]
  status: LibraryViewStatus
  dir: LibrarySortDir
  setDir: (dir: LibrarySortDir) => void
}

const EMPTY_FILTER: LibraryFilter = {}

export function useLibraryView(
  active: boolean,
  filter: LibraryFilter = EMPTY_FILTER,
): UseLibraryView {
  const [sounds, setSounds] = useState<LibrarySound[]>([])
  const [status, setStatus] = useState<LibraryViewStatus>('idle')
  const [dir, setDir] = useState<LibrarySortDir>('desc')
  const revision = useLibrary((s) => s.revision)
  const noteMany = useLibrary((s) => s.noteMany)

  // Order-independent identity so the effect re-runs on a real filter change.
  const filterKey = JSON.stringify(filter)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setStatus('loading')
    window.core
      .filterLibrary(filter, { sort: 'savedAt', dir })
      .then((list) => {
        if (cancelled) return
        setSounds(list)
        setStatus('ok')
        // Keep the badge store in step with what the Library actually holds.
        noteMany(Object.fromEntries(list.map((s) => [s.id, true])))
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, dir, revision, filterKey, noteMany])

  return { sounds, status, dir, setDir }
}
