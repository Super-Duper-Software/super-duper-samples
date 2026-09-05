import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { LibrarySound, Sound } from '../../core/types'
import { useRowTransport } from '../hooks/useRowTransport'
import { useTransport } from '../store/useTransport'
import { selectRowStaging, useStaging } from '../store/useStaging'
import { selectRowLibrary, useLibrary } from '../store/useLibrary'
import { selectRowCollections, useCollections } from '../store/useCollections'
import { selectRowChecked, useMultiSelect } from '../store/useMultiSelect'
import { formatDuration } from '../lib/format'
import { waveformIconDataUrl } from '../lib/dragIcon'
import { useViewport } from '../lib/viewport'
import { CollectionMenu } from './CollectionMenu'
import { LicenseChip } from './LicenseChip'
import { OverflowMenu } from './OverflowMenu'
import type { OverflowMenuItem } from './OverflowMenu'
import { StagingChip } from './StagingChip'
import { Waveform } from './Waveform'

export interface ResultRowProps {
  sound: Sound
  index: number
  selected: boolean
  /** Pixel offset from the top of the scrolled content (from the virtualizer). */
  start: number
  /** Row height in pixels. */
  size: number
  onSelect: (index: number) => void
  /**
   * `'search'` (default) shows a "Saved" badge on Sounds already in the Library
   * and a "＋" menu to save-and-file in one action. `'library'` and
   * `'collection'` show the per-row actions (rename / reveal / page / remove),
   * a multi-select checkbox and the Collection-membership badges. `'collection'`
   * differs only in that "remove" means "remove from this Collection", not
   * "delete from the Library".
   */
  variant?: 'search' | 'library' | 'collection'
  /** Library / collection variants: remove this Sound (the caller confirms if needed). */
  onRemove?: (sound: Sound) => void
  /** Override the remove button's label (e.g. "Remove from collection"). */
  removeLabel?: string
  /** Override the remove button's tooltip. */
  removeTitle?: string
  /**
   * Library / collection variants: open the Edit view (ticket 07) on this
   * Sound. Omit to hide the "Edit" affordance entirely.
   */
  onEdit?: (sound: Sound) => void
}

function ResultRowImpl({
  sound,
  index,
  selected,
  start,
  size,
  onSelect,
  variant = 'search',
  onRemove,
  removeLabel,
  removeTitle,
  onEdit,
}: ResultRowProps) {
  const handleSelect = useCallback(() => onSelect(index), [onSelect, index])

  const { isRail } = useViewport()

  const isLibraryVariant = variant === 'library' || variant === 'collection'

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

  const onAddToCollection = useCallback(
    (collectionId: number) => {
      void useCollections.getState().addSounds(collectionId, [sound.id])
    },
    [sound.id],
  )

  const { checked } = useMultiSelect(useShallow(selectRowChecked(sound.id)))
  const toggleChecked = useMultiSelect((s) => s.toggle)

  const onDownload = useCallback(() => {
    void useLibrary.getState().save(sound)
  }, [sound])

  const [armDelete, setArmDelete] = useState(false)
  const onDeleteFromLibrary = useCallback(() => {
    setArmDelete(false)
    void useLibrary.getState().remove(sound.id)
    useStaging.getState().note(sound.id, 'not-started')
  }, [sound.id])

  const { status: stagingStatus } = useStaging(useShallow(selectRowStaging(sound.id)))
  const ensureStaging = useStaging((s) => s.ensure)
  useEffect(() => {
    ensureStaging([sound.id])
  }, [sound.id, ensureStaging])

  const overlay = sound as Partial<LibrarySound>
  const customName = overlay.customName ?? null
  const customTags = overlay.customTags ?? []
  const isEdit = (overlay.derivedFrom ?? null) !== null
  const displayName = customName ?? sound.name

  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [addingTag, setAddingTag] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const [editingTags, setEditingTags] = useState(false)

  const [pickNonce, setPickNonce] = useState(0)
  const [overflowKey, setOverflowKey] = useState(0)
  const pickerHostRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (pickNonce === 0) return
    pickerHostRef.current?.querySelector('button')?.click()
  }, [pickNonce])

  const startRename = useCallback(() => {
    setRenameDraft(customName ?? sound.name)
    setRenaming(true)
  }, [customName, sound.name])

  const commitRename = useCallback(() => {
    const next = renameDraft.trim()
    setRenaming(false)
    void useLibrary.getState().rename(sound.id, next === '' ? null : next)
  }, [sound.id, renameDraft])

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

  const onRemoveTag = useCallback(
    (tag: string) => {
      void useLibrary.getState().setTags(
        sound.id,
        customTags.filter((x) => x.toLowerCase() !== tag.toLowerCase()),
      )
    },
    [sound.id, customTags],
  )

  const handlePickCollection = useCallback(
    (collectionId: number) => {
      onAddToCollection(collectionId)
      setOverflowKey((k) => k + 1)
    },
    [onAddToCollection],
  )

  const openFreesoundPage = useCallback(() => {
    void window.core.openFreesoundPage(sound.id)
  }, [sound.id])

  const revealInFinder = useCallback(() => {
    void window.core.revealInFinder(sound.id)
  }, [sound.id])

  const menuItems = useMemo<OverflowMenuItem[]>(() => {
    const addToCollection: OverflowMenuItem = {
      label: 'Add to collection',
      opensNestedPicker: true,
      disabled: !(isLibraryVariant || inLibrary),
      onSelect: () => {
        setPickNonce((n) => n + 1)
        setOverflowKey((k) => k + 1)
      },
    }
    const openPage: OverflowMenuItem = {
      label: 'Open Freesound page',
      onSelect: openFreesoundPage,
    }
    const licenceDetail: OverflowMenuItem = {
      label: `Licence · ${sound.license.name}`,
      disabled: true,
      onSelect: () => {},
    }
    const selectToggle: OverflowMenuItem = {
      label: checked ? 'Deselect' : 'Select',
      onSelect: () => toggleChecked(sound.id),
    }

    if (variant === 'search') {
      if (!isRail) return [openPage, addToCollection]
      const removeOrGet: OverflowMenuItem = inLibrary
        ? {
            label: removeLabel ?? 'Remove from Library',
            destructive: true,
            onSelect: onDeleteFromLibrary,
          }
        : { label: '⬇ Download', onSelect: onDownload }
      return [removeOrGet, addToCollection, openPage, licenceDetail]
    }

    const editTags: OverflowMenuItem = {
      label: 'Edit tags',
      onSelect: () => setEditingTags(true),
    }
    const rename: OverflowMenuItem = { label: 'Rename', onSelect: startRename }
    const reveal: OverflowMenuItem = {
      label: 'Reveal in Finder',
      onSelect: revealInFinder,
    }
    const editAction: OverflowMenuItem = {
      label: '✂ Edit',
      disabled: stagingStatus !== 'ready',
      onSelect: () => onEdit?.(sound),
    }
    const common = [addToCollection, editTags, rename, reveal, openPage]

    if (variant === 'collection') {
      if (!isRail) return common
      const items: OverflowMenuItem[] = []
      if (onEdit) items.push(editAction)
      items.push({
        label: removeLabel ?? 'Remove from collection',
        destructive: true,
        onSelect: () => onRemove?.(sound),
      })
      items.push(...common, licenceDetail, selectToggle)
      return items
    }

    const libraryRemove: OverflowMenuItem = {
      label: removeLabel ?? 'Remove from Library',
      destructive: true,
      onSelect: () => onRemove?.(sound),
    }
    if (!isRail) return [...common, libraryRemove]
    const items: OverflowMenuItem[] = []
    if (onEdit) items.push(editAction)
    items.push(libraryRemove, ...common, licenceDetail, selectToggle)
    return items
  }, [
    variant,
    isRail,
    isLibraryVariant,
    inLibrary,
    checked,
    stagingStatus,
    openFreesoundPage,
    revealInFinder,
    startRename,
    toggleChecked,
    onDownload,
    onDeleteFromLibrary,
    onEdit,
    removeLabel,
    onRemove,
    sound,
  ])

  const { isCurrent, status, failed } = useRowTransport(sound.id)
  const isPlaying = isCurrent && status === 'playing'
  const isLoading = isCurrent && status === 'loading'

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
    noticeTimer.current = window.setTimeout(() => setDragNotice(null), 4500)
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
        flashNotice(
          stagingStatus === 'failed'
            ? "This sound's Original could not be downloaded — it can't be dragged out."
            : stagingStatus === 'queued' || stagingStatus === 'downloading'
              ? 'Still downloading this sound — wait for “Downloaded” before dragging.'
              : 'Download this sound first (the ⬇ Download button), then drag it out.',
        )
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

  const isNonCommercial = sound.license.name.includes('NC')
  const railStateToken = isNonCommercial ? (
    <span
      role="alert"
      className="shrink-0 whitespace-nowrap rounded border-2 border-license-caution bg-surface-raised px-1 text-[10px] font-bold uppercase tracking-wide text-license-caution"
      title="Non-commercial license — this Sound may not be used in paid work"
    >
      ⚠ NC
    </span>
  ) : variant === 'search' && inLibrary ? (
    <span
      className="shrink-0 rounded border border-ok px-1 text-[10px] font-medium uppercase tracking-wide text-ok"
      title="In your Library — the Original is downloaded"
    >
      ✓ Downloaded
    </span>
  ) : (
    <StagingChip status={stagingStatus} />
  )

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      data-index={index}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMouseDown={handleSelect}
      onFocus={handleSelect}
      className={[
        'absolute inset-x-0 border-b border-line',
        'cursor-default select-none outline-none',
        isRail
          ? 'flex flex-col justify-center gap-1 px-2'
          : 'flex items-center gap-3 px-3',
        selected
          ? 'bg-surface-raised ring-1 ring-inset ring-focus'
          : 'hover:bg-surface',
      ].join(' ')}
      style={{ top: 0, height: size, transform: `translateY(${start}px)` }}
    >
      {isRail && (
        <>
          {/* Line 1: play · name (fills width) · ⋯ */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={isPlaying ? `Pause ${sound.name}` : `Play ${sound.name}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={onPlayPause}
              className={[
                'grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[10px]',
                isCurrent
                  ? 'border-accent-2 text-accent-2-text'
                  : 'border-line text-ink-muted hover:border-line-strong hover:text-ink',
              ].join(' ')}
            >
              {isLoading ? '…' : isPlaying ? '❚❚' : '▶'}
            </button>
            {renaming ? (
              <input
                type="text"
                autoFocus
                value={renameDraft}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitRename()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setRenaming(false)
                  }
                }}
                placeholder="blank = Freesound name"
                className="min-w-0 flex-1 rounded border border-focus bg-surface px-1.5 py-0.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
              />
            ) : (
              <span
                className="min-w-0 flex-1 truncate text-sm font-medium text-ink"
                title={
                  customName && !isEdit
                    ? `${customName}  (Freesound: ${sound.name})`
                    : sound.name
                }
              >
                {displayName}
              </span>
            )}
            <div className="relative flex shrink-0 items-center">
              <OverflowMenu
                key={overflowKey}
                label={`More actions for ${displayName}`}
                title="More actions"
                items={menuItems}
              />
              <span
                ref={pickerHostRef}
                aria-hidden
                className="pointer-events-none absolute right-0 top-0 opacity-0"
              >
                <CollectionMenu
                  label=""
                  onPick={handlePickCollection}
                  title="Add this sound to a collection"
                  className="block h-0 w-0 overflow-hidden p-0"
                />
              </span>
            </div>
          </div>

          {/* Line 2: small waveform · duration · format · one state token · tags */}
          <div
            className="flex items-center gap-2 overflow-hidden"
            title={
              sound.tags.length > 0
                ? `Freesound tags: ${sound.tags.join(', ')}`
                : undefined
            }
          >
            <Waveform
              soundId={sound.id}
              url={sound.waveformUrls.m}
              active={isCurrent}
              className="h-6 w-16 shrink-0 rounded-sm"
            />
            <span className="shrink-0 text-xs tabular-nums text-ink-muted">
              {formatDuration(sound.duration)}
            </span>
            <span
              className="shrink-0 rounded border border-line px-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint"
              title={`File format: ${sound.type.toUpperCase()}`}
            >
              {sound.type}
            </span>
            {railStateToken}
            {isLibraryVariant &&
              (editingTags ? (
                <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                  {customTags.map((t) => (
                    <button
                      key={`c:${t}`}
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => onRemoveTag(t)}
                      className="inline-flex shrink-0 items-center gap-0.5 rounded border border-ok px-1 text-[10px] text-ok hover:bg-surface-raised"
                      title="Your tag — click to remove"
                    >
                      <span># {t}</span>
                      <span aria-hidden>×</span>
                    </button>
                  ))}
                  {addingTag ? (
                    <input
                      type="text"
                      autoFocus
                      value={tagDraft}
                      onMouseDown={(e) => e.stopPropagation()}
                      onChange={(e) => setTagDraft(e.target.value)}
                      onBlur={commitAddTag}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitAddTag()
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          setAddingTag(false)
                        }
                      }}
                      placeholder="tag + Enter"
                      className="w-24 shrink-0 rounded border border-focus bg-surface px-1 text-[10px] text-ink placeholder:text-ink-faint focus:outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={startAddTag}
                      className="shrink-0 rounded border border-line px-1 text-[10px] text-ink-muted hover:border-line-strong hover:text-ink"
                      title="Add your own tag"
                    >
                      + tag
                    </button>
                  )}
                  <button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      setAddingTag(false)
                      setEditingTags(false)
                    }}
                    className="shrink-0 rounded border border-line px-1 text-[10px] text-ink-muted hover:border-line-strong hover:text-ink"
                    title="Done editing tags"
                  >
                    ✓ done
                  </button>
                </span>
              ) : (
                customTags.length > 0 && (
                  <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                    {customTags.map((t) => (
                      <span
                        key={`c:${t}`}
                        className="inline-flex shrink-0 items-center rounded border border-ok px-1 text-[10px] text-ok"
                        title="Your tag — edit from the ⋯ menu"
                      >
                        # {t}
                      </span>
                    ))}
                  </span>
                )
              ))}
          </div>
        </>
      )}

      {!isRail && (
      <>
      {isLibraryVariant && (
        <input
          type="checkbox"
          checked={checked}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={() => toggleChecked(sound.id)}
          aria-label={`Select ${displayName} for batch actions`}
          className="h-3.5 w-3.5 shrink-0 accent-[var(--sd-accent-2)]"
        />
      )}

      <button
        type="button"
        aria-label={isPlaying ? `Pause ${sound.name}` : `Play ${sound.name}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onPlayPause}
        className={[
          'grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[11px]',
          isCurrent
            ? 'border-accent-2 text-accent-2-text'
            : 'border-line text-ink-muted hover:border-line-strong hover:text-ink',
        ].join(' ')}
      >
        {isLoading ? '…' : isPlaying ? '❚❚' : '▶'}
      </button>

      <Waveform
        soundId={sound.id}
        url={sound.waveformUrls.m}
        active={isCurrent}
        className="h-9 w-28 shrink-0 rounded-sm"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {renaming ? (
            <input
              type="text"
              autoFocus
              value={renameDraft}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitRename()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setRenaming(false)
                }
              }}
              placeholder="blank = Freesound name"
              className="min-w-0 flex-1 rounded border border-focus bg-surface px-1.5 py-0.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
            />
          ) : (
            <span
              className="truncate text-sm font-medium text-ink"
              title={
                customName && !isEdit
                  ? `${customName}  (Freesound: ${sound.name})`
                  : sound.name
              }
            >
              {displayName}
            </span>
          )}
          {isLibraryVariant && customName && !isEdit && (
            <span
              className="shrink-0 truncate text-[11px] italic text-ink-faint"
              title={`Freesound name: ${sound.name}`}
            >
              aka {sound.name}
            </span>
          )}
          <span className="shrink-0 text-xs text-ink-faint">
            {sound.username}
          </span>
        </div>
        <div
          className="mt-0.5 flex items-center gap-2 overflow-hidden"
          title={
            sound.tags.length > 0
              ? `Freesound tags: ${sound.tags.join(', ')}`
              : undefined
          }
        >
          <span className="shrink-0 text-xs tabular-nums text-ink-muted">
            {formatDuration(sound.duration)}
          </span>
          <span
            className="shrink-0 rounded border border-line px-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint"
            title={`File format: ${sound.type.toUpperCase()}`}
          >
            {sound.type}
          </span>
          {failed && (
            <span
              className="shrink-0 rounded border border-error px-1 text-[10px] font-medium uppercase tracking-wide text-error"
              title="This Preview failed to load — try again or pick another sound"
            >
              preview failed
            </span>
          )}
          {/* Library / collection rows use the chip for drag-readiness; on a
              search row the Download button below carries the same state. */}
          {isLibraryVariant && <StagingChip status={stagingStatus} />}
          {variant === 'search' &&
            (stagingStatus === 'queued' || stagingStatus === 'downloading' ? (
              <span
                className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint"
                title="Downloading this sound's Original from Freesound"
              >
                Downloading…
              </span>
            ) : stagingStatus === 'failed' && !inLibrary ? (
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={onDownload}
                className="shrink-0 rounded border border-error px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-error hover:bg-surface-raised"
                title="The download failed — try again"
              >
                ↻ Retry download
              </button>
            ) : inLibrary ? (
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onMouseEnter={() => setArmDelete(true)}
                onMouseLeave={() => setArmDelete(false)}
                onClick={onDeleteFromLibrary}
                className={[
                  'w-[104px] shrink-0 rounded border px-1.5 py-0.5 text-center text-[10px] font-medium uppercase tracking-wide',
                  armDelete
                    ? 'border-error text-error hover:bg-surface-raised'
                    : 'border-ok text-ok',
                ].join(' ')}
                title="In your Library — click to remove it and delete the downloaded Original"
              >
                {armDelete ? 'Delete?' : '✓ Downloaded'}
              </button>
            ) : (
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={onDownload}
                className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted hover:border-line-strong hover:text-ink"
                title="Download this sound's Original from Freesound and save it to your Library"
              >
                ⬇ Download
              </button>
            ))}
          {showCollections &&
            memberOf.map((c) => (
              <span
                key={`col:${c.id}`}
                className="shrink-0 truncate rounded border border-accent-2 px-1 text-[10px] text-accent-2-text"
                title={`In the collection “${c.name}”`}
              >
                {c.name}
              </span>
            ))}
          {isLibraryVariant &&
            (editingTags ? (
              <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                {customTags.map((t) => (
                  <button
                    key={`c:${t}`}
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => onRemoveTag(t)}
                    className="inline-flex shrink-0 items-center gap-0.5 rounded border border-ok px-1 text-[10px] text-ok hover:bg-surface-raised"
                    title="Your tag — click to remove"
                  >
                    <span># {t}</span>
                    <span aria-hidden>×</span>
                  </button>
                ))}
                {addingTag ? (
                  <input
                    type="text"
                    autoFocus
                    value={tagDraft}
                    onMouseDown={(e) => e.stopPropagation()}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onBlur={commitAddTag}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitAddTag()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        setAddingTag(false)
                      }
                    }}
                    placeholder="tag + Enter"
                    className="w-28 shrink-0 rounded border border-focus bg-surface px-1 text-[10px] text-ink placeholder:text-ink-faint focus:outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={startAddTag}
                    className="shrink-0 rounded border border-line px-1 text-[10px] text-ink-muted hover:border-line-strong hover:text-ink"
                    title="Add your own tag"
                  >
                    + tag
                  </button>
                )}
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    setAddingTag(false)
                    setEditingTags(false)
                  }}
                  className="shrink-0 rounded border border-line px-1 text-[10px] text-ink-muted hover:border-line-strong hover:text-ink"
                  title="Done editing tags"
                >
                  ✓ done
                </button>
              </span>
            ) : (
              customTags.length > 0 && (
                <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                  {customTags.map((t) => (
                    <span
                      key={`c:${t}`}
                      className="inline-flex shrink-0 items-center rounded border border-ok px-1 text-[10px] text-ok"
                      title="Your tag — edit from the ⋯ menu"
                    >
                      # {t}
                    </span>
                  ))}
                </span>
              )
            ))}
        </div>
      </div>

      {/* Visible row action: ✂ Edit (Library / Collection). The one action
          unique to this app is never buried in the `⋯` menu. */}
      {isLibraryVariant && onEdit && (
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => onEdit(sound)}
          disabled={stagingStatus !== 'ready'}
          className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-muted hover:border-line-strong hover:text-ink disabled:opacity-40"
          title={
            stagingStatus === 'ready'
              ? 'Open the Edit view — trim a region and audition the cut'
              : "This sound's Original is not on disk yet — it can't be edited"
          }
        >
          ✂ Edit
        </button>
      )}

      {/* Visible row action: Remove from collection stays on the Collection row
          — frequent and non-destructive here (the Sound stays in the Library). */}
      {variant === 'collection' && (
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => onRemove?.(sound)}
          className="shrink-0 rounded border border-error px-1.5 py-0.5 text-[11px] text-error hover:bg-surface-raised"
          title={
            removeTitle ??
            'Remove from this collection — the sound stays in your Library'
          }
        >
          {removeLabel ?? 'Remove from collection'}
        </button>
      )}

      {/* Per-row `⋯`. `CollectionMenu` is mounted invisibly alongside it and
          driven programmatically for the "Add to collection" nested step. */}
      <div className="relative flex shrink-0 items-center">
        <OverflowMenu
          key={overflowKey}
          label={`More actions for ${displayName}`}
          title="More actions"
          items={menuItems}
        />
        <span
          ref={pickerHostRef}
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 opacity-0"
        >
          <CollectionMenu
            label=""
            onPick={handlePickCollection}
            title="Add this sound to a collection"
            className="block h-0 w-0 overflow-hidden p-0"
          />
        </span>
      </div>

      {/* Fixed-width trailing licence slot: always rendered so the action
          buttons to its left line up from row to row. The badge inside fills
          the whole slot (`w-full`) with centred text, and the slot is wide
          enough for the longest label ("⚠ Non-commercial") so nothing spills
          left over the `⋯`. */}
      <div className="flex w-32 shrink-0 items-center">
        {sound.license.name.includes('NC') ? (
          <span
            role="alert"
            className="block w-full whitespace-nowrap rounded border-2 border-license-caution bg-surface-raised px-1.5 py-0.5 text-center text-[10px] font-bold uppercase tracking-wide text-license-caution"
            title="Non-commercial license — this Sound may not be used in paid work"
          >
            ⚠ Non-commercial
          </span>
        ) : (
          <LicenseChip name={sound.license.name} className="w-full" />
        )}
      </div>
      </>
      )}

      {dragNotice && (
        <div
          role="alert"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 truncate bg-surface-raised px-3 py-0.5 text-[11px] text-warn"
        >
          {dragNotice}
        </div>
      )}
    </div>
  )
}

export const ResultRow = memo(ResultRowImpl)
