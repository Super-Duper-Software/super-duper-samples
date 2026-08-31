// A small dropdown for picking a Collection — or creating one inline (ticket 16).
// Used in two places:
//   - on a search row ("＋" — save the Sound and file it in one action)
//   - in the batch bar over the Library / a Collection ("Add to collection ▾")
//
// Presentation only: it calls back with the chosen Collection id. The "New
// collection" field creates through `useCollections` and then picks the result,
// so filing a brand-new Collection is still one gesture.

import { useCallback, useEffect, useId, useRef, useState } from 'react'
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

export function CollectionMenu({
  label,
  onPick,
  className,
  title,
}: CollectionMenuProps) {
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const collections = useCollections((s) => s.collections)
  const load = useCollections((s) => s.load)
  const create = useCollections((s) => s.create)
  const fieldId = useId()

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
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
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        className={
          className ??
          'rounded border border-neutral-700 px-1.5 py-0.5 text-[11px] text-neutral-300 hover:border-neutral-500 hover:text-neutral-100'
        }
      >
        {label}
      </button>

      {open && (
        <div
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute right-0 z-20 mt-1 w-56 rounded border border-neutral-700 bg-neutral-900 p-1 shadow-lg"
        >
          <div className="max-h-52 overflow-auto">
            {collections.length === 0 && (
              <p className="px-2 py-1.5 text-[11px] text-neutral-500">
                No collections yet.
              </p>
            )}
            {collections.map((c) => (
              <button
                key={c.id}
                type="button"
                role="menuitem"
                onClick={() => pick(c.id)}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs text-neutral-200 hover:bg-neutral-800"
              >
                <span className="truncate">{c.name}</span>
                <span className="shrink-0 tabular-nums text-[10px] text-neutral-500">
                  {c.count}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-1 flex items-center gap-1 border-t border-neutral-800 pt-1">
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
              className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-1.5 py-1 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-emerald-600 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void onCreate()}
              disabled={newName.trim() === ''}
              className="shrink-0 rounded border border-neutral-700 px-1.5 py-1 text-[11px] text-neutral-300 hover:border-neutral-500 hover:text-neutral-100 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
