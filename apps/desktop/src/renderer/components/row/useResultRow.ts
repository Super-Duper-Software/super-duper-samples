import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { LibrarySound } from '../../../core/types'
import { useRowTransport } from '../../hooks/useRowTransport'
import { useTransport } from '../../store/useTransport'
import { selectRowStaging, useStaging } from '../../store/useStaging'
import { selectRowLibrary, useLibrary } from '../../store/useLibrary'
import { selectRowCollections, useCollections } from '../../store/useCollections'
import { selectRowChecked, useMultiSelect } from '../../store/useMultiSelect'
import { waveformIconDataUrl } from '../../lib/dragIcon'
import { useViewport } from '../../lib/viewport'
import { buildRowMenuItems } from './rowMenuItems'
import type { ResultRowProps, RowModel } from './types'

const DRAG_NOTICE_MS = 4500

function dragBlockedMessage(status: string): string {
  if (status === 'failed') {
    return "This sound's Original could not be downloaded — it can't be dragged out."
  }
  if (status === 'queued' || status === 'downloading') {
    return 'Still downloading this sound — wait for “Downloaded” before dragging.'
  }
  return 'Download this sound first (the ⬇ Download button), then drag it out.'
}

/** All of one row's subscriptions, local state and actions. */
export function useResultRow(props: ResultRowProps): RowModel {
  const { sound, index, onSelect, variant = 'search', onEdit, onRemove } = props
  const { isRail } = useViewport()
  const isLibraryVariant = variant === 'library' || variant === 'collection'

  const handleSelect = useCallback(() => onSelect(index), [onSelect, index])

  const { inLibrary } = useLibrary(useShallow(selectRowLibrary(sound.id)))
  const ensureLibrary = useLibrary((s) => s.ensure)
  useEffect(() => {
    ensureLibrary([sound.id])
  }, [sound.id, ensureLibrary])

  const showCollections = isLibraryVariant || inLibrary
  const memberOf = useCollections(useShallow(selectRowCollections(sound.id)))
  const ensureMemberships = useCollections((s) => s.ensureMemberships)
  useEffect(() => {
    if (showCollections) ensureMemberships([sound.id])
  }, [sound.id, showCollections, ensureMemberships])

  const { checked } = useMultiSelect(useShallow(selectRowChecked(sound.id)))
  const toggle = useMultiSelect((s) => s.toggle)
  const toggleChecked = useCallback(() => toggle(sound.id), [toggle, sound.id])

  const { status: stagingStatus } = useStaging(
    useShallow(selectRowStaging(sound.id)),
  )
  const ensureStaging = useStaging((s) => s.ensure)
  useEffect(() => {
    ensureStaging([sound.id])
  }, [sound.id, ensureStaging])

  const overlay = sound as Partial<LibrarySound>
  const customName = overlay.customName ?? null
  const customTags = useMemo(() => overlay.customTags ?? [], [overlay.customTags])
  const isEdit = (overlay.derivedFrom ?? null) !== null

  const onDownload = useCallback(() => {
    void useLibrary.getState().save(sound)
  }, [sound])

  const [armDelete, setArmDelete] = useState(false)
  const onDeleteFromLibrary = useCallback(() => {
    setArmDelete(false)
    void useLibrary.getState().remove(sound.id)
    useStaging.getState().note(sound.id, 'not-started')
  }, [sound.id])

  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const startRename = useCallback(() => {
    setRenameDraft(customName ?? sound.name)
    setRenaming(true)
  }, [customName, sound.name])
  const commitRename = useCallback(() => {
    const next = renameDraft.trim()
    setRenaming(false)
    void useLibrary.getState().rename(sound.id, next === '' ? null : next)
  }, [sound.id, renameDraft])
  const cancelRename = useCallback(() => setRenaming(false), [])

  const [editingTags, setEditingTags] = useState(false)
  const [addingTag, setAddingTag] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const startAddTag = useCallback(() => {
    setTagDraft('')
    setAddingTag(true)
  }, [])
  const commitAddTag = useCallback(() => {
    const t = tagDraft.trim()
    setAddingTag(false)
    if (!t || customTags.some((x) => x.toLowerCase() === t.toLowerCase())) return
    void useLibrary.getState().setTags(sound.id, [...customTags, t])
  }, [sound.id, customTags, tagDraft])
  const cancelAddTag = useCallback(() => setAddingTag(false), [])
  const onRemoveTag = useCallback(
    (tag: string) => {
      void useLibrary
        .getState()
        .setTags(
          sound.id,
          customTags.filter((x) => x.toLowerCase() !== tag.toLowerCase()),
        )
    },
    [sound.id, customTags],
  )

  const [pickNonce, setPickNonce] = useState(0)
  const [overflowKey, setOverflowKey] = useState(0)
  const pickerHostRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (pickNonce === 0) return
    pickerHostRef.current?.querySelector('button')?.click()
  }, [pickNonce])

  const onPickCollection = useCallback(
    (collectionId: number) => {
      void useCollections.getState().addSounds(collectionId, [sound.id])
      setOverflowKey((k) => k + 1)
    },
    [sound.id],
  )

  const onOpenFreesoundPage = useCallback(() => {
    void window.core.openFreesoundPage(sound.id)
  }, [sound.id])
  const onRevealInFinder = useCallback(() => {
    void window.core.revealInFinder(sound.id)
  }, [sound.id])

  const menuItems = useMemo(
    () =>
      buildRowMenuItems({
        sound,
        variant,
        isRail,
        inLibrary,
        checked,
        stagingStatus,
        removeLabel: props.removeLabel,
        onEdit,
        onRemove,
        onDownload,
        onDeleteFromLibrary,
        onOpenFreesoundPage,
        onRevealInFinder,
        onStartRename: startRename,
        onEditTags: () => setEditingTags(true),
        onToggleChecked: toggleChecked,
        onAddToCollection: () => {
          setPickNonce((n) => n + 1)
          setOverflowKey((k) => k + 1)
        },
      }),
    [
      sound,
      variant,
      isRail,
      inLibrary,
      checked,
      stagingStatus,
      props.removeLabel,
      onEdit,
      onRemove,
      onDownload,
      onDeleteFromLibrary,
      onOpenFreesoundPage,
      onRevealInFinder,
      startRename,
      toggleChecked,
    ],
  )

  const { isCurrent, status, failed } = useRowTransport(sound.id)
  const onPlayPause = useCallback(() => {
    const t = useTransport.getState()
    if (isCurrent) t.toggle()
    else t.playSound(sound)
  }, [isCurrent, sound])

  const [dragNotice, setDragNotice] = useState<string | null>(null)
  const noticeTimer = useRef<number | null>(null)
  const flashNotice = useCallback((msg: string) => {
    setDragNotice(msg)
    if (noticeTimer.current != null) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(
      () => setDragNotice(null),
      DRAG_NOTICE_MS,
    )
  }, [])
  useEffect(
    () => () => {
      if (noticeTimer.current != null) window.clearTimeout(noticeTimer.current)
    },
    [],
  )

  const onDragEnd = useCallback(() => {
    void window.core.endDrag([sound.id])
  }, [sound.id])

  const onDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      if (stagingStatus !== 'ready') {
        flashNotice(dragBlockedMessage(stagingStatus))
        return
      }
      void (async () => {
        const iconDataUrl = await waveformIconDataUrl(sound.waveformUrls.m)
        try {
          await window.core.startDrag(
            [sound.id],
            iconDataUrl ? { iconDataUrl } : undefined,
          )
        } catch (err) {
          flashNotice(
            err instanceof Error && err.message
              ? err.message
              : 'Could not start the drag.',
          )
        }
      })()
    },
    [sound.id, sound.waveformUrls.m, stagingStatus, flashNotice],
  )

  return {
    props,
    variant,
    isLibraryVariant,
    displayName: customName ?? sound.name,
    customName,
    customTags,
    isEdit,
    inLibrary,
    showCollections,
    memberOf,
    checked,
    toggleChecked,
    stagingStatus,
    isCurrent,
    isPlaying: isCurrent && status === 'playing',
    isLoading: isCurrent && status === 'loading',
    previewFailed: failed,
    onPlayPause,
    onDownload,
    onDeleteFromLibrary,
    armDelete,
    setArmDelete,
    renaming,
    renameDraft,
    setRenameDraft,
    startRename,
    commitRename,
    cancelRename,
    editingTags,
    setEditingTags,
    addingTag,
    tagDraft,
    setTagDraft,
    startAddTag,
    commitAddTag,
    cancelAddTag,
    onRemoveTag,
    menuItems,
    overflowKey,
    pickerHostRef,
    onPickCollection,
    handleSelect,
    onDragStart,
    onDragEnd,
    dragNotice,
  }
}
