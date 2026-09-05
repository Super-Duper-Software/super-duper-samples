import { useCallback, useEffect, useRef, useState } from 'react'
import type { CollectionSummary, Sound } from '../../core/types'
import { useCollections } from '../store/useCollections'
import { useMultiSelect } from '../store/useMultiSelect'
import { useResultSelection } from '../store/useResultSelection'

export type View = 'search' | 'library' | 'collections' | 'edit'

const PERSIST_DEBOUNCE_MS = 400

export interface ShellState {
  view: View
  /** Switch view, clearing the selections and panels that belonged to the old one. */
  selectView: (v: View) => void
  query: string
  setQuery: (q: string) => void
  openCollection: CollectionSummary | null
  setOpenCollection: (c: CollectionSummary | null) => void
  editingSound: Sound | null
  openEdit: (sound: Sound) => void
  closeEdit: () => void
  showManifest: boolean
  setShowManifest: (v: boolean) => void
  showSupport: boolean
  setShowSupport: (v: boolean) => void
  /** False until the persisted shell state has been read; gates the first search. */
  uiReady: boolean
  /** The row to re-select once the active list contains it. See `useRestoreSelection`. */
  pendingSelectedSoundId: number | null
  clearPendingSelection: () => void
}

/**
 * The shell's view state, restored from the persisted `UiState` on mount and
 * written back (debounced) on every change. Restoring an open Collection or an
 * Edit needs data that arrives later, so those are held until it does.
 */
export function useShellState(): ShellState {
  const [view, setView] = useState<View>('search')
  const [query, setQuery] = useState('')
  const [openCollection, setOpenCollection] =
    useState<CollectionSummary | null>(null)
  const [editingSound, setEditingSound] = useState<Sound | null>(null)
  const [showManifest, setShowManifest] = useState(false)
  const [showSupport, setShowSupport] = useState(false)
  const [uiReady, setUiReady] = useState(false)
  const [pendingSelectedSoundId, setPendingSelectedSoundId] = useState<
    number | null
  >(null)

  const preEditView = useRef<View>('search')
  const restore = useRef<{
    openCollectionId?: number | null
    editSoundId?: number | null
  }>({})

  const openEdit = useCallback(
    (sound: Sound) => {
      preEditView.current = view === 'edit' ? preEditView.current : view
      setEditingSound(sound)
      setView('edit')
    },
    [view],
  )

  const closeEdit = useCallback(() => {
    setEditingSound(null)
    setView(preEditView.current)
  }, [])

  const clearPendingSelection = useCallback(
    () => setPendingSelectedSoundId(null),
    [],
  )

  const selectView = useCallback((v: View) => {
    setView(v)
    useResultSelection.getState().clear()
    useMultiSelect.getState().clear()
    setShowManifest(false)
    if (v !== 'collections') setOpenCollection(null)
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.core
      .getUiState()
      .then((s) => {
        if (cancelled) return
        if (s.view && s.view !== 'edit') setView(s.view as View)
        if (typeof s.query === 'string') setQuery(s.query)
        if (!s.supportPromptDismissed) setShowSupport(true)
        setPendingSelectedSoundId(s.selectedSoundId ?? null)
        restore.current = {
          openCollectionId: s.openCollectionId ?? null,
          editSoundId: s.view === 'edit' ? (s.editSoundId ?? null) : null,
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setUiReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!uiReady) return
    const want = restore.current.editSoundId
    if (want == null) return
    restore.current.editSoundId = null
    void window.core
      .listLibrary()
      .then((sounds) => {
        const match = sounds.find((s) => s.id === want)
        if (match) openEdit(match)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiReady])

  const selectedSoundId = useResultSelection((s) => s.selectedId)
  useEffect(() => {
    if (!uiReady) return
    const t = setTimeout(() => {
      void window.core.setUiState({
        view,
        query,
        openCollectionId: openCollection?.id ?? null,
        selectedSoundId: selectedSoundId ?? null,
        editSoundId: view === 'edit' ? (editingSound?.id ?? null) : null,
      })
    }, PERSIST_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [uiReady, view, query, openCollection, selectedSoundId, editingSound])

  const collectionsList = useCollections((s) => s.collections)
  const collectionsRevision = useCollections((s) => s.revision)

  useEffect(() => {
    if (!openCollection) return
    const fresh = collectionsList.find((c) => c.id === openCollection.id)
    if (!fresh) setOpenCollection(null)
    else if (
      fresh.name !== openCollection.name ||
      fresh.count !== openCollection.count
    )
      setOpenCollection(fresh)
  }, [collectionsList, openCollection, collectionsRevision])

  useEffect(() => {
    if (!uiReady) return
    const want = restore.current.openCollectionId
    if (want == null) return
    if (collectionsList.length === 0) return
    const match = collectionsList.find((c) => c.id === want)
    if (match) setOpenCollection(match)
    restore.current.openCollectionId = null
  }, [uiReady, collectionsList])

  return {
    view,
    selectView,
    query,
    setQuery,
    openCollection,
    setOpenCollection,
    editingSound,
    openEdit,
    closeEdit,
    showManifest,
    setShowManifest,
    showSupport,
    setShowSupport,
    uiReady,
    pendingSelectedSoundId,
    clearPendingSelection,
  }
}

/**
 * Restore the previously selected row once the list it belongs to has loaded.
 * Kept out of `useShellState` because only the caller knows which list is
 * showing; it is a no-op until that list contains the wanted Sound.
 */
export function useRestoreSelection(
  shell: ShellState,
  listSounds: readonly { id: number }[],
): void {
  const { pendingSelectedSoundId, clearPendingSelection } = shell
  useEffect(() => {
    if (pendingSelectedSoundId == null) return
    const idx = listSounds.findIndex((s) => s.id === pendingSelectedSoundId)
    if (idx >= 0) {
      useResultSelection.getState().select(idx, pendingSelectedSoundId)
      clearPendingSelection()
    }
  }, [pendingSelectedSoundId, clearPendingSelection, listSounds])
}
