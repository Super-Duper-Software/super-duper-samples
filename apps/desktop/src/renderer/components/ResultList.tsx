// The virtualized, keyboard-navigable result list.
//
//   - TanStack Virtual windows the rows: the DOM holds only what is on-screen
//     plus a small overscan, so 20 results and 2,000 results cost the same.
//   - Up / Down move a selection held in the `useResultSelection` store (which
//     ticket 04 reads to drive play / prev / next); the selection is scrolled
//     into view with the virtualizer and the row DOM node takes focus.
//   - `/` or Esc hand focus back to the search box.
//   - Scrolling within five rows of the end asks the parent for the next page.

import { useCallback, useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Sound } from '../../core/types'
import { useResultSelection } from '../store/useResultSelection'
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
}

export function ResultList({
  sounds,
  hasMore,
  loadingMore,
  loadMore,
  onFocusSearch,
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

  // Ask for the next page as the tail comes into view. Guarded upstream against
  // duplicate in-flight requests.
  useEffect(() => {
    if (!hasMore || loadingMore) return
    const last = virtualItems[virtualItems.length - 1]
    if (last && last.index >= sounds.length - 1 - LOAD_MORE_THRESHOLD) {
      loadMore()
    }
  }, [virtualItems, hasMore, loadingMore, loadMore, sounds.length])

  // Scroll the selected row into view and move DOM focus onto it, so arrow keys
  // keep working from the list.
  useEffect(() => {
    if (selectedIndex < 0) return
    virtualizer.scrollToIndex(selectedIndex, { align: 'auto' })
    const node = parentRef.current?.querySelector<HTMLElement>(
      `[data-index="${selectedIndex}"]`,
    )
    node?.focus()
  }, [selectedIndex, virtualizer, virtualItems])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        move(1, resolveId)
        break
      case 'ArrowUp':
        e.preventDefault()
        move(-1, resolveId)
        break
      case '/':
      case 'Escape':
        e.preventDefault()
        onFocusSearch()
        break
      default:
        break
    }
  }

  return (
    <div
      ref={parentRef}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="listbox"
      aria-label="Search results"
      className="h-full overflow-auto outline-none"
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
            />
          )
        })}
      </div>

      {loadingMore && (
        <div className="py-2 text-center text-xs text-neutral-500">
          Loading more…
        </div>
      )}
    </div>
  )
}
