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
          className="w-64 rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-focus focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void onCreate()}
          disabled={newName.trim() === ''}
          className="rounded border border-line px-2 py-1.5 text-xs text-ink hover:border-line-strong hover:text-ink disabled:opacity-40"
        >
          Create
        </button>
      </div>

      {loaded && collections.length === 0 && (
        <p className="text-sm text-ink-muted">
          No collections yet. Create one above, then add sounds to it from your
          Library or search results.
        </p>
      )}

      <ul className="flex flex-col gap-1">
        {collections.map((c) => (
          <li key={c.id}>
            <div className="flex items-center gap-2 rounded border border-line px-3 py-2 hover:border-line-strong">
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
                  className="min-w-0 flex-1 rounded border border-focus bg-surface px-2 py-1 text-sm text-ink focus:outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onOpen(c)}
                  className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                >
                  <span className="truncate text-sm font-medium text-ink">
                    {c.name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-faint">
                    {c.count} {c.count === 1 ? 'sound' : 'sounds'}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => startRename(c)}
                className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-muted hover:border-line-strong hover:text-ink"
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => onDelete(c)}
                className="rounded border border-error px-1.5 py-0.5 text-[11px] text-error hover:bg-surface-raised"
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
