// The Collections browse list (ticket 16). A flat, non-nesting list — there is
// no tree, no drag-to-reparent, nothing that implies a Collection can contain
// another Collection. Clicking one opens its Sounds in the same list UI the
// Library uses.
//
//   - "New collection" field at the top (Enter or the button creates).
//   - Each row: name + count, Rename (inline input — Electron has no
//     window.prompt), Delete (window.confirm — consistent with the Library
//     delete), and the row itself opens it.

import { useCallback, useEffect, useState } from 'react'
import type { CollectionSummary } from '../../preload'
import { useCollections } from '../store/useCollections'

export interface CollectionsPanelProps {
  onOpen: (collection: CollectionSummary) => void
}

export function CollectionsPanel({ onOpen }: CollectionsPanelProps) {
  const collections = useCollections((s) => s.collections)
  const loaded = useCollections((s) => s.loaded)
  const load = useCollections((s) => s.load)
  const create = useCollections((s) => s.create)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')

  useEffect(() => {
    void load()
  }, [load])

  const onCreate = useCallback(async () => {
    if (newName.trim() === '') return
    await create(newName)
    setNewName('')
  }, [create, newName])

  const startRename = useCallback((c: CollectionSummary) => {
    setEditingId(c.id)
    setEditDraft(c.name)
  }, [])

  const cancelRename = useCallback(() => {
    setEditingId(null)
    setEditDraft('')
  }, [])

  const commitRename = useCallback(
    (c: CollectionSummary) => {
      const next = editDraft.trim()
      setEditingId(null)
      setEditDraft('')
      if (next === '' || next === c.name) return
      void useCollections.getState().rename(c.id, next)
    },
    [editDraft],
  )

  const onDelete = useCallback((c: CollectionSummary) => {
    const ok = window.confirm(
      `Delete the collection “${c.name}”?\n\n` +
        'Its sounds stay in your Library and in any other collections — ' +
        'only this grouping is removed.',
    )
    if (ok) void useCollections.getState().remove(c.id)
  }, [])

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <input
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
          className="w-64 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-emerald-600 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void onCreate()}
          disabled={newName.trim() === ''}
          className="rounded border border-neutral-700 px-2 py-1.5 text-xs text-neutral-200 hover:border-neutral-500 hover:text-neutral-100 disabled:opacity-40"
        >
          Create
        </button>
      </div>

      {loaded && collections.length === 0 && (
        <p className="text-sm text-neutral-400">
          No collections yet. Create one above, then add sounds to it from your
          Library or search results.
        </p>
      )}

      <ul className="flex flex-col gap-1">
        {collections.map((c) => (
          <li key={c.id}>
            <div className="flex items-center gap-2 rounded border border-neutral-800 px-3 py-2 hover:border-neutral-700">
              {editingId === c.id ? (
                <input
                  type="text"
                  autoFocus
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onBlur={() => commitRename(c)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitRename(c)
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      cancelRename()
                    }
                  }}
                  className="min-w-0 flex-1 rounded border border-emerald-600 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 focus:outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onOpen(c)}
                  className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                >
                  <span className="truncate text-sm font-medium text-neutral-100">
                    {c.name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-neutral-500">
                    {c.count} {c.count === 1 ? 'sound' : 'sounds'}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => startRename(c)}
                className="rounded border border-neutral-700 px-1.5 py-0.5 text-[11px] text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => onDelete(c)}
                className="rounded border border-red-900/70 px-1.5 py-0.5 text-[11px] text-red-300 hover:border-red-600 hover:text-red-100"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
