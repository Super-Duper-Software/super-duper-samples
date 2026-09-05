import { useCallback } from 'react'
import { useCollections } from '../store/useCollections'
import { useMultiSelect } from '../store/useMultiSelect'
import { CollectionMenu } from './CollectionMenu'

export function AddToCollectionBar() {
  const checked = useMultiSelect((s) => s.checked)
  const clear = useMultiSelect((s) => s.clear)
  const count = checked.size

  const onPick = useCallback(
    (collectionId: number) => {
      const ids = [...useMultiSelect.getState().checked]
      if (ids.length === 0) return
      void useCollections.getState().addSounds(collectionId, ids)
      clear()
    },
    [clear],
  )

  if (count === 0) return null

  return (
    <div className="flex items-center gap-3 border-b border-line bg-surface-raised px-4 py-1.5 text-xs text-ink-muted">
      <span className="tabular-nums">
        {count} {count === 1 ? 'sound' : 'sounds'} selected
      </span>
      <CollectionMenu
        label="Add to collection ▾"
        onPick={onPick}
        title="Add the selected sounds to a collection"
      />
      <button
        type="button"
        onClick={clear}
        className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-muted hover:border-line-strong hover:text-ink"
      >
        Clear selection
      </button>
    </div>
  )
}
