import { AddToCollectionBar } from '../components/AddToCollectionBar'
import { ResultList } from '../components/ResultList'
import type { UseLibraryView } from '../hooks/useLibraryView'
import { useViewport } from '../lib/viewport'
import { useLibraryFilter } from '../store/useLibraryFilter'
import type { Sound } from '../../core/types'

export interface LibraryViewProps {
  library: UseLibraryView
  filtered: boolean
  resultCountText: string | null
  onFocusSearch: () => void
  onRemove: (sound: Sound) => void
  onEdit: (sound: Sound) => void
}

function EmptyLibrary({ filtered }: { filtered: boolean }) {
  if (filtered) {
    return (
      <div className="p-4 text-sm text-ink-muted">
        <p className="font-medium text-ink-muted">
          No Library sounds match this filter.
        </p>
        <button
          type="button"
          onClick={() => useLibraryFilter.getState().clearFilter()}
          className="mt-2 rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-muted hover:border-line-strong hover:text-ink"
        >
          Clear all filters
        </button>
      </div>
    )
  }
  return (
    <div className="p-4 text-sm text-ink-muted">
      <p className="font-medium text-ink-muted">Your Library is empty.</p>
      <p className="mt-1">
        Search for a sound, then press{' '}
        <kbd className="rounded border border-line px-1">s</kbd> or its{' '}
        <span className="font-medium">Download</span> button to fetch the
        Original and keep it here.
      </p>
    </div>
  )
}

export function LibraryView({
  library,
  filtered,
  resultCountText,
  onFocusSearch,
  onRemove,
  onEdit,
}: LibraryViewProps) {
  const { isRail } = useViewport()

  return (
    <div className="flex h-full flex-col">
      <AddToCollectionBar />

      {library.status === 'error' && (
        <p className="p-4 text-sm text-error" role="alert">
          Could not read the Library.
        </p>
      )}

      {library.status === 'ok' && library.sounds.length === 0 && (
        <EmptyLibrary filtered={filtered} />
      )}

      {library.sounds.length > 0 && (
        <div className="min-h-0 flex-1">
          <ResultList
            sounds={library.sounds}
            hasMore={false}
            loadingMore={false}
            loadMore={() => {}}
            onFocusSearch={onFocusSearch}
            variant="library"
            onRemove={onRemove}
            onEdit={onEdit}
            topSlot={isRail ? resultCountText : undefined}
          />
        </div>
      )}
    </div>
  )
}
