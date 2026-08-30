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
import type { Sound } from '../../core/types'
import { useRowTransport } from '../hooks/useRowTransport'
import { useTransport } from '../store/useTransport'
import { selectRowStaging, useStaging } from '../store/useStaging'
import { selectRowLibrary, useLibrary } from '../store/useLibrary'
import { formatDuration } from '../lib/format'
import { waveformIconDataUrl } from '../lib/dragIcon'
import { LicenseChip } from './LicenseChip'
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
   * `'search'` (default) shows a "Saved" badge on Sounds already in the Library.
   * `'library'` shows the per-row Library actions (reveal / open page / remove)
   * and no badge — everything here is saved by definition.
   */
  variant?: 'search' | 'library'
  /** Library variant only: remove this Sound (the caller confirms first). */
  onRemove?: (sound: Sound) => void
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
}: ResultRowProps) {
  const handleSelect = useCallback(() => onSelect(index), [onSelect, index])

  // Ticket 11: Library membership for the "Saved" badge. Mirrors the staging
  // pattern — a `useShallow` slice so only this row re-renders when it flips.
  const { inLibrary } = useLibrary(useShallow(selectRowLibrary(sound.id)))
  const ensureLibrary = useLibrary((s) => s.ensure)
  useEffect(() => {
    ensureLibrary([sound.id])
  }, [sound.id, ensureLibrary])

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
          <span className="truncate text-sm font-medium text-neutral-100" title={sound.name}>
            {sound.name}
          </span>
          <span className="shrink-0 text-xs text-neutral-500">{sound.username}</span>
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
          <span
            className="min-w-0 flex-1 truncate text-xs text-neutral-500"
            title={sound.tags.join(', ')}
          >
            {sound.tags.join(' · ')}
          </span>
        </div>
      </div>

      {variant === 'library' && (
        <div className="flex shrink-0 items-center gap-1">
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
            title="Remove from the Library and delete its files"
          >
            Remove
          </button>
        </div>
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
