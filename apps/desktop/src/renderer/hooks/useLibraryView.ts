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
