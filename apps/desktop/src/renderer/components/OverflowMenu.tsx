// The one `⋯` overflow menu for the whole shell. Any bar or row that cannot
// show all of its actions hands the rest to this primitive; it has no consumer
// of its own yet (ticket 03 is first use).
//
// Modelled on `CollectionMenu` so the codebase has a single menu style: the
// panel is rendered through a portal to <body> and positioned `fixed` against
// the trigger's rect. A result row is `position: absolute` with a `transform`
// (the virtualizer) and `overflow-hidden`, which both clips an in-flow dropdown
// and traps its `z-index` inside the row's stacking context. The portal escapes
// both.
//
// Presentation only: the caller supplies the items and owns what each one does.
// The menu closes after an item runs — unless the item is flagged as opening a
// nested picker (e.g. "Add to collection" opening `CollectionMenu`), in which
// case the flow is left open for that step to take over.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface OverflowMenuItem {
  /** Visible row label. */
  label: string
  /** Run when the item is activated (click, Enter or Space). */
  onSelect: () => void
  /** Optional leading glyph / icon node, rendered before the label. */
  icon?: ReactNode
  /** Render with the destructive style (e.g. "Remove"). */
  destructive?: boolean
  /** Greyed out and non-interactive; skipped by keyboard navigation. */
  disabled?: boolean
  /**
   * This item opens a nested picker of its own (e.g. `CollectionMenu`). The
   * menu is left open after `onSelect` runs so that step can take over; the
   * caller is responsible for closing the flow.
   */
  opensNestedPicker?: boolean
  /**
   * Explicit "keep the menu open after this item runs". Same effect as
   * `opensNestedPicker`; use whichever reads better at the call site.
   */
  keepOpen?: boolean
}

export interface OverflowMenuProps {
  /** The menu items, top to bottom. */
  items: OverflowMenuItem[]
  /** Accessible name for the trigger and the menu. Defaults to "More actions". */
  label?: string
  /** Extra classes for the trigger button (replaces the default styling). */
  className?: string
  /** Tooltip for the trigger. Defaults to `label`. */
  title?: string
  /** Notified when the menu opens (true) or closes (false). */
  onOpenChange?: (open: boolean) => void
}

const PANEL_WIDTH = 208 // w-52

const keepsMenuOpen = (item: OverflowMenuItem) =>
  Boolean(item.opensNestedPicker || item.keepOpen)

export function OverflowMenu({
  items,
  label = 'More actions',
  className,
  title,
  onOpenChange,
}: OverflowMenuProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  const firstEnabled = useMemo(
    () => items.findIndex((i) => !i.disabled),
    [items],
  )
  const lastEnabled = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) if (!items[i].disabled) return i
    return -1
  }, [items])

  const setOpenState = useCallback(
    (next: boolean) => {
      setOpen((prev) => {
        if (prev === next) return prev
        onOpenChange?.(next)
        return next
      })
    },
    [onOpenChange],
  )

  const close = useCallback(() => {
    setOpenState(false)
  }, [setOpenState])

  // Anchor the panel below-right of the trigger, flipping above if it would
  // overflow the viewport bottom. Recomputed on scroll / resize while open so
  // it tracks the row as the list scrolls.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const place = () => {
      const t = triggerRef.current?.getBoundingClientRect()
      if (!t) return
      const panelH = panelRef.current?.offsetHeight ?? 0
      const below = t.bottom + 4
      const flip = panelH > 0 && below + panelH > window.innerHeight
      setPos({
        top: flip ? Math.max(4, t.top - 4 - panelH) : below,
        left: Math.max(
          4,
          Math.min(t.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - 4),
        ),
      })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, items.length])

  // Outside-click / Escape close.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        !triggerRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        close()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  // On open, arm the first enabled item. On close (but not the initial mount),
  // return focus to the trigger.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open) {
      wasOpen.current = true
      setActiveIndex(firstEnabled)
      return
    }
    setActiveIndex(-1)
    if (wasOpen.current) {
      wasOpen.current = false
      triggerRef.current?.focus()
    }
  }, [open, firstEnabled])

  // Roving focus: move DOM focus to the active item.
  useEffect(() => {
    if (!open || activeIndex < 0) return
    itemRefs.current[activeIndex]?.focus()
  }, [open, activeIndex, pos])

  const step = useCallback(
    (dir: 1 | -1) => {
      setActiveIndex((cur) => {
        if (items.length === 0) return -1
        let next = cur
        for (let i = 0; i < items.length; i++) {
          next = (next + dir + items.length) % items.length
          if (!items[next].disabled) return next
        }
        return cur
      })
    },
    [items],
  )

  const activate = useCallback(
    (index: number) => {
      const item = items[index]
      if (!item || item.disabled) return
      // A nested-picker item (e.g. "Add to collection" opening CollectionMenu)
      // leaves the menu flow open so that step can take over — the caller owns
      // closing it. Every other item closes the menu once it has run.
      if (keepsMenuOpen(item)) {
        item.onSelect()
        return
      }
      item.onSelect()
      close()
    },
    [items, close],
  )

  const onMenuKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          step(1)
          break
        case 'ArrowUp':
          e.preventDefault()
          step(-1)
          break
        case 'Home':
          e.preventDefault()
          setActiveIndex(firstEnabled)
          break
        case 'End':
          e.preventDefault()
          setActiveIndex(lastEnabled)
          break
        case 'Enter':
        case ' ':
          e.preventDefault()
          if (activeIndex >= 0) activate(activeIndex)
          break
        case 'Tab':
          // A menu is a focus trap for arrow keys, not Tab — close and let
          // focus move on naturally from the trigger.
          close()
          break
        default:
          break
      }
    },
    [step, firstEnabled, lastEnabled, activeIndex, activate, close],
  )

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => (open ? close() : setOpenState(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={title ?? label}
        className={
          className ??
          'inline-flex items-center justify-center rounded border border-line px-1.5 py-0.5 text-[13px] leading-none text-ink-muted hover:border-line-strong hover:text-ink'
        }
      >
        <span aria-hidden>⋯</span>
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKeyDown}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              width: PANEL_WIDTH,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className="z-50 rounded border border-line bg-surface p-1 text-ink shadow-xl"
          >
            {items.length === 0 && (
              <p className="px-2 py-1.5 text-[11px] text-ink-faint">
                No actions.
              </p>
            )}
            {items.map((item, i) => (
              <button
                key={`${item.label}-${i}`}
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                type="button"
                role="menuitem"
                tabIndex={i === activeIndex ? 0 : -1}
                disabled={item.disabled}
                onClick={() => activate(i)}
                onMouseEnter={() => {
                  if (!item.disabled) setActiveIndex(i)
                }}
                className={[
                  'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs',
                  item.disabled
                    ? 'cursor-default text-ink-faint opacity-50'
                    : item.destructive
                      ? 'text-error hover:bg-surface-raised'
                      : 'text-ink hover:bg-surface-raised',
                ].join(' ')}
              >
                {item.icon != null && (
                  <span aria-hidden className="shrink-0 text-[11px]">
                    {item.icon}
                  </span>
                )}
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
