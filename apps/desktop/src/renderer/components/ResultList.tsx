// The virtualized, keyboard-navigable result list.
//
//   - TanStack Virtual windows the rows: the DOM holds only what is on-screen
//     plus a small overscan, so 20 results and 2,000 results cost the same.
//   - Up / Down move a selection held in the `useResultSelection` store (which
//     ticket 04 reads to drive play / prev / next); the selection is scrolled
//     into view with the virtualizer and the row DOM node takes focus.
//   - Esc hands focus back to the search box.
//   - Scrolling within five rows of the end asks the parent for the next page.
//
// Auditioning keys (ticket 04), handled here so they work while a row is focused
// and are inert while the search input is focused (this handler is scoped to the
// list, and the input has its own handler):
//   - Space  — play / pause the SELECTED row
//   - J      — select the next row AND start auditioning it
//   - K      — select the previous row AND start auditioning it
// Plain ArrowUp/ArrowDown still only move the selection.

import { useCallback, useEffect, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Sound } from '../../core/types'
import { useResultSelection } from '../store/useResultSelection'
import { useTransport } from '../store/useTransport'
import { useLibrary } from '../store/useLibrary'
import { ResultRow } from './ResultRow'

const ROW_HEIGHT = 64
const OVERSCAN = 8
/** Trigger the next page once the last rendered row is this close to the end. */
const LOAD_MORE_THRESHOLD = 5

export interface ResultListProps {
  sounds: Sound[]
  hasMore: boolean
  loadingMore: boolean
  loadMore: () => void
  /** Return focus to the search input (bound to `/` and Esc). */
  onFocusSearch: () => void
  /**
   * `'search'` (default), `'library'`, or `'collection'`. The non-search
   * variants show per-row actions + a checkbox and bind Delete/Backspace to
   * `onRemove` for the selected row.
   */
  variant?: 'search' | 'library' | 'collection'
  /** Library / collection variants: remove a Sound (the caller confirms if needed). */
  onRemove?: (sound: Sound) => void
  /** Override the per-row remove button label (e.g. "Remove from collection"). */
  removeLabel?: string
  /** Override the per-row remove button tooltip. */
  removeTitle?: string
  /** Library / collection variants: open the Edit view (ticket 07) on a row. */
  onEdit?: (sound: Sound) => void
  /**
   * Rendered as a non-scrolling strip above the list body. Spec 0003 puts the
   * live result count here in the rail layout (it stays in the header in wide).
   */
  topSlot?: ReactNode
  /**
   * Changing this scrolls the list back to the top and drops the selection —
   * e.g. a new query / sort / filter. Leave unset for lists that should keep
   * their scroll position across updates (Library / Collection).
   */
  resetKey?: string | number
}

export function ResultList({
  sounds,
  hasMore,
  loadingMore,
  loadMore,
  onFocusSearch,
  variant = 'search',
  onRemove,
  removeLabel,
  removeTitle,
  onEdit,
  topSlot,
  resetKey,
}: ResultListProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  const selectedIndex = useResultSelection((s) => s.selectedIndex)
  const select = useResultSelection((s) => s.select)
  const move = useResultSelection((s) => s.move)
  const setCount = useResultSelection((s) => s.setCount)

  const virtualizer = useVirtualizer({
    count: sounds.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  })

  const virtualItems = virtualizer.getVirtualItems()

  // Keep the selection store's bounds in step with what is loaded. `setCount`
  // also drops a now-out-of-range selection (e.g. after a new query empties the
  // list).
  useEffect(() => {
    setCount(sounds.length)
  }, [sounds.length, setCount])

  const resolveId = useCallback(
    (index: number) => sounds[index]?.id ?? null,
    [sounds],
  )

  const onSelect = useCallback(
    (index: number) => select(index, sounds[index]?.id ?? null),
    [select, sounds],
  )

  // Select row `index` and immediately start auditioning it.
  const auditionAt = useCallback(
    (index: number) => {
      const sound = sounds[index]
      if (!sound) return
      select(index, sound.id)
      useTransport.getState().playSound(sound)
    },
    [select, sounds],
  )

  // J / K: step the selection and audition the landing row.
  const auditionRelative = useCallback(
    (delta: number) => {
      const from = useResultSelection.getState().selectedIndex
      const base = from < 0 ? (delta > 0 ? -1 : 0) : from
      const next = Math.min(sounds.length - 1, Math.max(0, base + delta))
      if (next < 0 || next === from) {
        if (from < 0 && delta > 0 && sounds[0]) auditionAt(0)
        return
      }
      auditionAt(next)
    },
    [auditionAt, sounds.length],
  )

  // Auto-advance: when a Sound ends and the toggle is on, play the next result.
  // At the end of the loaded list, ask for more if there is more, else stop.
  useEffect(() => {
    useTransport.getState().setAdvance(() => {
      const from = useResultSelection.getState().selectedIndex
      const nextIndex = from + 1
      if (sounds[nextIndex]) {
        auditionAt(nextIndex)
      } else {
        if (hasMore) loadMore()
        useTransport.setState({ status: 'paused' })
      }
    })
    return () => useTransport.getState().setAdvance(null)
  }, [sounds, hasMore, loadMore, auditionAt])

  // Ask for the next page as the tail comes into view. Guarded upstream against
  // duplicate in-flight requests.
  useEffect(() => {
    if (!hasMore || loadingMore) return
    const last = virtualItems[virtualItems.length - 1]
    if (last && last.index >= sounds.length - 1 - LOAD_MORE_THRESHOLD) {
      loadMore()
    }
  }, [virtualItems, hasMore, loadingMore, loadMore, sounds.length])

  // Scroll the selected row into view and move DOM focus onto it — but ONLY when
  // the selection itself changes (keyboard nav / a click), never on scroll.
  // `virtualItems` is deliberately kept OUT of the deps: with it in, this ran on
  // every scroll frame and yanked the viewport back to the selected row, so the
  // user could not scroll past a highlighted row.
  const focusPendingRef = useRef<number | null>(null)
  useEffect(() => {
    if (selectedIndex < 0) {
      focusPendingRef.current = null
      return
    }
    focusPendingRef.current = selectedIndex
    virtualizer.scrollToIndex(selectedIndex, { align: 'auto' })
  }, [selectedIndex, virtualizer])

  // When the selection jumps outside the rendered window the target row is not
  // in the DOM yet; focus it once it mounts, then clear the flag so later
  // scrolls don't re-focus it and fight the user.
  useEffect(() => {
    const want = focusPendingRef.current
    if (want == null) return
    const node = parentRef.current?.querySelector<HTMLElement>(
      `[data-index="${want}"]`,
    )
    if (node) {
      node.focus({ preventScroll: true })
      focusPendingRef.current = null
    }
  }, [virtualItems])

  // A new query / sort / filter resets the list: scroll to the top and drop a
  // now-meaningless selection. Skipped on first mount so a restored selection
  // (ticket 18) survives. Declared AFTER the selection-scroll effect so that on
  // a commit where the query changed this runs last and its scroll-to-top wins
  // over the outgoing selection's scroll-into-view.
  const resetArmed = useRef(false)
  useEffect(() => {
    if (!resetArmed.current) {
      resetArmed.current = true
      return
    }
    focusPendingRef.current = null
    useResultSelection.getState().clear()
    virtualizer.scrollToOffset(0)
    if (parentRef.current) parentRef.current.scrollTop = 0
  }, [resetKey, virtualizer])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Don't let list shortcuts fire while the user is typing in an inline
    // editor inside a row (rename / add-tag). The row's own <input> handles
    // Enter / Escape.
    const el = e.target as HTMLElement
    if (
      el.isContentEditable ||
      el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT'
    ) {
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        move(1, resolveId)
        break
      case 'ArrowUp':
        e.preventDefault()
        move(-1, resolveId)
        break
      case 'j':
      case 'J':
        e.preventDefault()
        auditionRelative(1)
        break
      case 'k':
      case 'K':
        e.preventDefault()
        auditionRelative(-1)
        break
      case ' ': {
        e.preventDefault()
        const idx = useResultSelection.getState().selectedIndex
        const sound = sounds[idx]
        if (!sound) break
        const t = useTransport.getState()
        if (t.currentSoundId === sound.id) t.toggle()
        else t.playSound(sound)
        break
      }
      case 's':
      case 'S': {
        // Ticket 11 (revised): one keystroke downloads the selected Sound's
        // Original and saves it to the Library. Idempotent — pressing it again on
        // an already-downloaded row is harmless.
        e.preventDefault()
        const sound = sounds[useResultSelection.getState().selectedIndex]
        if (sound) void useLibrary.getState().save(sound)
        break
      }
      case 'Backspace':
      case 'Delete': {
        if (variant === 'search' || !onRemove) break
        e.preventDefault()
        const sound = sounds[useResultSelection.getState().selectedIndex]
        if (sound) onRemove(sound)
        break
      }
      case 'Escape':
        e.preventDefault()
        onFocusSearch()
        break
      default:
        break
    }
  }

  return (
    <div className="flex h-full flex-col">
      {topSlot != null && (
        <div
          className="shrink-0 px-4 py-2 text-xs text-ink-muted"
          aria-live="polite"
        >
          {topSlot}
        </div>
      )}
      <div
        ref={parentRef}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="listbox"
        aria-label="Search results"
        className="min-h-0 flex-1 overflow-auto outline-none"
      >
        <div
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualItems.map((vi) => {
            const sound = sounds[vi.index]
            if (!sound) return null
            return (
              <ResultRow
                key={sound.id}
                sound={sound}
                index={vi.index}
                selected={vi.index === selectedIndex}
                start={vi.start}
                size={vi.size}
                onSelect={onSelect}
                variant={variant}
                onRemove={onRemove}
                removeLabel={removeLabel}
                removeTitle={removeTitle}
                onEdit={onEdit}
              />
            )
          })}
        </div>

        {loadingMore && (
          <div className="py-2 text-center text-xs text-ink-faint">
            Loading more…
          </div>
        )}
      </div>
    </div>
  )
}
