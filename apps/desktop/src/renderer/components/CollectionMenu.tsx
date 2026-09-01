// A small dropdown for picking a Collection — or creating one inline (ticket 16).
// Used in two places:
//   - on a downloaded search row ("＋ Collection" — file the Sound in one action)
//   - in the batch bar over the Library / a Collection ("Add to collection ▾")
//
// Presentation only: it calls back with the chosen Collection id. The "New
// collection" field creates through `useCollections` and then picks the result,
// so filing a brand-new Collection is still one gesture.
//
// The panel is rendered through a portal to <body> and positioned `fixed`
// against the trigger's rect. A search row is `position: absolute` with a
// `transform` (the virtualizer), which both clips overflow and traps `z-index`
// inside the row's own stacking context — an in-flow dropdown would be drawn
// behind the following rows and show their hover background through it. The
// portal escapes both.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useCollections } from '../store/useCollections'

export interface CollectionMenuProps {
  /** Button label. */
  label: string
  /** Called with the chosen (or freshly created) Collection id. */
  onPick: (collectionId: number) => void
  /** Extra classes for the trigger button. */
  className?: string
  title?: string
}

const PANEL_WIDTH = 224 // w-56

export function CollectionMenu({
  label,
  onPick,
  className,
  title,
}: CollectionMenuProps) {
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const collections = useCollections((s) => s.collections)
  const load = useCollections((s) => s.load)
  const create = useCollections((s) => s.create)
  const fieldId = useId()

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  // Anchor the panel to the trigger, right-aligned, flipping above the trigger
  // if it would overflow the viewport bottom. Recomputed on scroll / resize
  // while open so it tracks the row as the list scrolls.
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
  }, [open, collections.length])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        !triggerRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = useCallback(
    (id: number) => {
      setOpen(false)
      onPick(id)
    },
    [onPick],
  )

  const onCreate = useCallback(async () => {
    const made = await create(newName)
    if (!made) return
    setNewName('')
    pick(made.id)
  }, [create, newName, pick])

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        className={
          className ??
          'rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-muted hover:border-line-strong hover:text-ink'
        }
      >
        {label}
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
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
            <div className="max-h-52 overflow-auto">
              {collections.length === 0 && (
                <p className="px-2 py-1.5 text-[11px] text-ink-faint">
                  No collections yet.
                </p>
              )}
              {collections.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="menuitem"
                  onClick={() => pick(c.id)}
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs text-ink hover:bg-surface-raised"
                >
                  <span className="truncate">{c.name}</span>
                  <span className="shrink-0 tabular-nums text-[10px] text-ink-faint">
                    {c.count}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-1 flex items-center gap-1 border-t border-line pt-1">
              <label htmlFor={fieldId} className="sr-only">
                New collection name
              </label>
              <input
                id={fieldId}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void onCreate()
                  }
                }}
                placeholder="New collection…"
                className="min-w-0 flex-1 rounded border border-line bg-bg px-1.5 py-1 text-xs text-ink placeholder:text-ink-faint focus:border-focus focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void onCreate()}
                disabled={newName.trim() === ''}
                className="shrink-0 rounded border border-line px-1.5 py-1 text-[11px] text-ink-muted hover:border-line-strong hover:text-ink disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
