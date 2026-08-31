// One result row. Memoized and fed only primitives (plus the stable `sound`
// object and a stable `onSelect`), so a scroll that changes which rows are
// on-screen re-renders only the rows that entered/left — never every row, and
// never on a per-frame cadence.
//
// Auditioning (ticket 04): the row's ONLY tie to playback is `useRowTransport`,
// a `useShallow` subscription to `{ isCurrent, status, failed }`. It gets NO
// playhead / currentTime prop. The 60fps playhead is written straight to a DOM
// node inside <Waveform> by `audioController`, so it never re-renders this row.
// A track change flips `isCurrent` for exactly the outgoing and incoming rows.

import { memo, useCallback, useEffect, useRef, useState } from 'react'
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
import { LicenseChip } from './LicenseChip'
import { StagingChip } from './StagingChip'
import { Waveform } from './Waveform'
import { CollectionMenu } from './CollectionMenu'

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
}: ResultRowProps) {
  const handleSelect = useCallback(() => onSelect(index), [onSelect, index])

  // Library-like rows (Library tab or an open Collection) share the same
  // affordances: checkbox, Collection badges, rename / tags / remove.
  const isLibraryVariant = variant === 'library' || variant === 'collection'

  // Ticket 16: which Collections this Sound belongs to (row badges).
  const memberOf = useCollections(useShallow(selectRowCollections(sound.id)))
  const ensureMemberships = useCollections((s) => s.ensureMemberships)
  useEffect(() => {
    if (isLibraryVariant) ensureMemberships([sound.id])
  }, [sound.id, isLibraryVariant, ensureMemberships])

  // Ticket 16: minimal checkbox multi-select for batch "add to collection".
  const { checked } = useMultiSelect(useShallow(selectRowChecked(sound.id)))
  const toggleChecked = useMultiSelect((s) => s.toggle)

  // Ticket 16: on a search row, save the Sound AND file it in one action.
  const onSaveInto = useCallback(
    (collectionId: number) => {
      void (async () => {
        try {
          await window.core?.saveToLibrary?.(sound.id, sound, [collectionId])
        } catch {
          return
        }
        useLibrary.getState().note(sound.id, true)
        await useCollections.getState().load()
        await useCollections.getState().refreshMemberships([sound.id])
      })()
    },
    [sound],
  )

  // Ticket 11: Library membership for the "Saved" badge. Mirrors the staging
  // pattern — a `useShallow` slice so only this row re-renders when it flips.
  const { inLibrary } = useLibrary(useShallow(selectRowLibrary(sound.id)))
  const ensureLibrary = useLibrary((s) => s.ensure)
  useEffect(() => {
    ensureLibrary([sound.id])
  }, [sound.id, ensureLibrary])

  // Ticket 13: the user's local overlay is carried on the Sound in the Library
  // view (`variant="library"`). `customName ?? name` is what a Drag-Out delivers.
  const overlay = sound as Partial<LibrarySound>
  const customName = overlay.customName ?? null
  const customTags = overlay.customTags ?? []
  const displayName = customName ?? sound.name

  // Electron's renderer has no window.prompt, so rename / add-tag are inline
  // <input>s that appear in place (Enter commits, Escape / blur cancels).
  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [addingTag, setAddingTag] = useState(false)
  const [tagDraft, setTagDraft] = useState('')

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

  const { isCurrent, status, failed } = useRowTransport(sound.id)
  const isPlaying = isCurrent && status === 'playing'
  const isLoading = isCurrent && status === 'loading'

  // Ticket 08: the staged-download indicator. Status is pushed from the core;
  // seed it once for this row in case it changed before the row mounted.
  const { status: stagingStatus } = useStaging(useShallow(selectRowStaging(sound.id)))
  const ensureStaging = useStaging((s) => s.ensure)
  useEffect(() => {
    ensureStaging([sound.id])
  }, [sound.id, ensureStaging])

  const onPlayPause = useCallback(() => {
    const t = useTransport.getState()
    if (isCurrent) t.toggle()
    else t.playSound(sound)
  }, [isCurrent, sound])

  // Ticket 09: drag the Sound's Original straight out of the app. The row is
  // always draggable; a drag attempted before the Original is staged is refused
  // with a visible message here (never a silent no-op, never a Preview).
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

  // Ticket 10: tell the core the drag is over (whatever the drop outcome) so it
  // lifts the eviction-skip hold `startDrag` placed on this Sound's Original.
  const onDragEnd = useCallback(() => {
    void window.core.endDrag([sound.id])
  }, [sound.id])

  const onDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault() // hand the drag to Electron's native OS drag
      if (stagingStatus !== 'ready') {
        flashNotice(
          stagingStatus === 'failed'
            ? "This sound's Original could not be downloaded — it can't be dragged out."
            : 'Still preparing this sound. Press play and wait for “ready” before dragging.',
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
        'absolute inset-x-0 flex items-center gap-3 border-b border-neutral-800 px-3',
        'cursor-default select-none outline-none',
        selected
          ? 'bg-neutral-800 ring-1 ring-inset ring-emerald-500'
          : 'hover:bg-neutral-900',
      ].join(' ')}
      style={{ top: 0, height: size, transform: `translateY(${start}px)` }}
    >
      {isLibraryVariant && (
        <input
          type="checkbox"
          checked={checked}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={() => toggleChecked(sound.id)}
          aria-label={`Select ${displayName} for batch actions`}
          className="h-3.5 w-3.5 shrink-0 accent-emerald-500"
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
            ? 'border-emerald-500 bg-emerald-600/20 text-emerald-300'
            : 'border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:text-neutral-100',
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
              className="min-w-0 flex-1 rounded border border-emerald-600 bg-neutral-900 px-1.5 py-0.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none"
            />
          ) : (
            <span
              className="truncate text-sm font-medium text-neutral-100"
              title={
                customName
                  ? `${customName}  (Freesound: ${sound.name})`
                  : sound.name
              }
            >
              {displayName}
            </span>
          )}
          {isLibraryVariant && customName && (
            <span
              className="shrink-0 truncate text-[11px] italic text-neutral-500"
              title={`Freesound name: ${sound.name}`}
            >
              aka {sound.name}
            </span>
          )}
          <span className="shrink-0 text-xs text-neutral-500">
            {sound.username}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 overflow-hidden">
          <span className="shrink-0 text-xs tabular-nums text-neutral-400">
            {formatDuration(sound.duration)}
          </span>
          {failed && (
            <span
              className="shrink-0 rounded border border-red-800/70 bg-red-950/60 px-1 text-[10px] font-medium uppercase tracking-wide text-red-300"
              title="This Preview failed to load — try again or pick another sound"
            >
              preview failed
            </span>
          )}
          <StagingChip status={stagingStatus} />
          {variant === 'search' && inLibrary && (
            <span
              className="shrink-0 rounded border border-emerald-800/70 bg-emerald-950/60 px-1 text-[10px] font-medium uppercase tracking-wide text-emerald-300"
              title="Already in your Library"
            >
              ♥ saved
            </span>
          )}
          {variant === 'search' && (
            <CollectionMenu
              label="＋ list"
              onPick={onSaveInto}
              className="shrink-0 rounded border border-neutral-700 px-1 text-[10px] text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
              title="Save to your Library and add to a collection in one step"
            />
          )}
          {isLibraryVariant &&
            memberOf.map((c) => (
              <span
                key={`col:${c.id}`}
                className="shrink-0 truncate rounded border border-sky-800/70 bg-sky-950/50 px-1 text-[10px] text-sky-300"
                title={`In the collection “${c.name}”`}
              >
                {c.name}
              </span>
            ))}
          {isLibraryVariant ? (
            <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              {customTags.map((t) => (
                <button
                  key={`c:${t}`}
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => onRemoveTag(t)}
                  className="inline-flex shrink-0 items-center gap-0.5 rounded border border-emerald-700/70 bg-emerald-950/60 px-1 text-[10px] text-emerald-300 hover:border-emerald-500 hover:text-emerald-100"
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
                  className="w-28 shrink-0 rounded border border-emerald-600 bg-neutral-900 px-1 text-[10px] text-neutral-100 placeholder:text-neutral-600 focus:outline-none"
                />
              ) : (
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={startAddTag}
                  className="shrink-0 rounded border border-neutral-700 px-1 text-[10px] text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
                  title="Add your own tag"
                >
                  + tag
                </button>
              )}
              {sound.tags.length > 0 && (
                <span
                  className="min-w-0 truncate text-[11px] text-neutral-600"
                  title={`From Freesound: ${sound.tags.join(', ')}`}
                >
                  {sound.tags.join(' · ')}
                </span>
              )}
            </span>
          ) : (
            <span
              className="min-w-0 flex-1 truncate text-xs text-neutral-500"
              title={sound.tags.join(', ')}
            >
              {sound.tags.join(' · ')}
            </span>
          )}
        </div>
      </div>

      {isLibraryVariant && (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={startRename}
            className="rounded border border-neutral-700 px-1.5 py-0.5 text-[11px] text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
            title="Give this sound your own name (used on drag-out)"
          >
            Rename
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => void window.core.revealInFinder(sound.id)}
            className="rounded border border-neutral-700 px-1.5 py-0.5 text-[11px] text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
            title="Reveal the Original in Finder / Explorer"
          >
            Reveal
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => void window.core.openFreesoundPage(sound.id)}
            className="rounded border border-neutral-700 px-1.5 py-0.5 text-[11px] text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
            title="Open this sound's page on freesound.org"
          >
            Page
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onRemove?.(sound)}
            className="rounded border border-red-900/70 px-1.5 py-0.5 text-[11px] text-red-300 hover:border-red-600 hover:text-red-100"
            title={
              removeTitle ?? 'Remove from the Library and delete its files'
            }
          >
            {removeLabel ?? 'Remove'}
          </button>
        </div>
      )}

      {sound.license.name.includes('NC') && (
        <span
          role="alert"
          className="shrink-0 rounded border border-amber-500 bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-200"
          title="Non-commercial license — this Sound may not be used in paid work"
        >
          ⚠ Non-commercial
        </span>
      )}

      <LicenseChip name={sound.license.name} />

      {dragNotice && (
        <div
          role="alert"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 truncate bg-amber-950/95 px-3 py-0.5 text-[11px] text-amber-100"
        >
          {dragNotice}
        </div>
      )}
    </div>
  )
}

export const ResultRow = memo(ResultRowImpl)

// ─────────────────────────────────────────────────────────────────────────────
// Verifying "the playhead does not re-render rows" (ticket 04, checkbox 11).
//
// Automated: `test/renderer.transport.test.ts` proves the state-shape invariant
// — the transport store has no per-frame field, and volume/loop/seek keep every
// row's `useShallow` selector output shallow-equal.
//
// Manual (needs the Electron GUI, not available in CI):
//   1. `pnpm --filter @freesound/desktop dev`, run a search, press ▶ on a row.
//   2. React DevTools → Profiler → gear → "Highlight updates when components
//      render". While the playhead sweeps the waveform, NO row outline flashes.
//      Only when you start a different track do exactly two rows flash (the old
//      current row and the new one).
//   3. Profiler → Record a few seconds of playback → the commit list stays
//      empty during the sweep (0 commits/sec from playhead motion). Starting a
//      track produces a single commit touching 2 <ResultRow> instances.
//   4. In the Performance panel, the rAF work shows up as tiny style
//      recalculations on one node (`.waveform-playhead`), no React render.
// ─────────────────────────────────────────────────────────────────────────────
