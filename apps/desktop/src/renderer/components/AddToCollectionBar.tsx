// Batch action bar for the Library / Collection views (ticket 16). Appears only
// while one or more rows are checked. "Add to collection" files every checked
// Sound into the chosen Collection in one action (the core call is idempotent,
// so re-adding some is harmless).

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
    <div className="flex items-center gap-3 border-b border-neutral-800 bg-neutral-900/80 px-4 py-1.5 text-xs text-neutral-300">
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
        className="rounded border border-neutral-700 px-1.5 py-0.5 text-[11px] text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
      >
        Clear selection
      </button>
    </div>
  )
}
