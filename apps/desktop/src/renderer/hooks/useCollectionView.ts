// Loads one Collection's Sounds for the Collections tab (ticket 16).
//
// Like `useLibraryView`: no paging, no gateway — `window.core.listCollectionSounds`
// is served entirely from the local database, so it works offline and feels
// instant. Re-fetches when the open Collection changes, when the sort direction
// changes, and whenever `useCollections.revision` or `useLibrary.revision`
// bumps (an add / remove / rename / retag / delete happened).

import { useEffect, useState } from 'react'
import type { LibrarySound } from '../../preload'
import { useCollections } from '../store/useCollections'
import { useLibrary } from '../store/useLibrary'

export type CollectionViewStatus = 'idle' | 'loading' | 'ok' | 'error'
export type SortDir = 'asc' | 'desc'

export interface UseCollectionView {
  sounds: LibrarySound[]
  status: CollectionViewStatus
  dir: SortDir
  setDir: (dir: SortDir) => void
}

export function useCollectionView(
  collectionId: number | null,
): UseCollectionView {
  const [sounds, setSounds] = useState<LibrarySound[]>([])
  const [status, setStatus] = useState<CollectionViewStatus>('idle')
  const [dir, setDir] = useState<SortDir>('desc')
  const colRevision = useCollections((s) => s.revision)
  const libRevision = useLibrary((s) => s.revision)
  const noteMany = useLibrary((s) => s.noteMany)

  useEffect(() => {
    if (collectionId == null) {
      setSounds([])
      setStatus('idle')
      return
    }
    let cancelled = false
    setStatus('loading')
    window.core
      .listCollectionSounds(collectionId, { dir })
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
  }, [collectionId, dir, colRevision, libRevision, noteMany])

  return { sounds, status, dir, setDir }
}
