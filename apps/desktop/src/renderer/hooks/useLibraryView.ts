// Loads the Library list for the Library tab (ticket 11).
//
// Unlike `useSearch` there is no paging and no gateway: `window.core.listLibrary`
// is served entirely from the local database, so this works offline and while
// signed out. It re-fetches when the tab becomes active, when the sort
// direction changes, and whenever `useLibrary.revision` bumps (a save or a
// remove happened).

import { useEffect, useState } from 'react'
import type { Sound } from '../../core/types'
import { useLibrary } from '../store/useLibrary'

export type LibrarySortDir = 'asc' | 'desc'
export type LibraryViewStatus = 'idle' | 'loading' | 'ok' | 'error'

export interface UseLibraryView {
  sounds: Sound[]
  status: LibraryViewStatus
  dir: LibrarySortDir
  setDir: (dir: LibrarySortDir) => void
}

export function useLibraryView(active: boolean): UseLibraryView {
  const [sounds, setSounds] = useState<Sound[]>([])
  const [status, setStatus] = useState<LibraryViewStatus>('idle')
  const [dir, setDir] = useState<LibrarySortDir>('desc')
  const revision = useLibrary((s) => s.revision)
  const noteMany = useLibrary((s) => s.noteMany)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setStatus('loading')
    window.core
      .listLibrary({ sort: 'savedAt', dir })
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
  }, [active, dir, revision, noteMany])

  return { sounds, status, dir, setDir }
}
