import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { AuthBar } from './components/AuthBar'
import { FilterBar } from './components/FilterBar'
import { LibraryFilterBar } from './components/LibraryFilterBar'
import { ResultList } from './components/ResultList'
import { StagingConsentBanner } from './components/StagingConsentBanner'
import { RebuildBanner } from './components/RebuildBanner'
import { TransportBar } from './components/TransportBar'
import { CollectionsPanel } from './components/CollectionsPanel'
import { AddToCollectionBar } from './components/AddToCollectionBar'
import { useSearch } from './hooks/useSearch'
import { useLibraryView } from './hooks/useLibraryView'
import { useCollectionView } from './hooks/useCollectionView'
import { formatResultCount } from './lib/format'
import { activeFilterChips } from './lib/filterLabels'
import { useResultSelection } from './store/useResultSelection'
import { useLibrary } from './store/useLibrary'
import { useCollections } from './store/useCollections'
import { useMultiSelect } from './store/useMultiSelect'
import { useLibraryFilter, hasLibraryFilter } from './store/useLibraryFilter'
import { useSearchPrefs } from './store/useSearchPrefs'
import type { CollectionSummary, Sound } from '../core/types'

type View = 'search' | 'library' | 'collections'

export default function App() {
  const [view, setView] = useState<View>('search')
  const [openCollection, setOpenCollection] = useState<CollectionSummary | null>(
    null,
  )
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const sort = useSearchPrefs((s) => s.sort)
  const filter = useSearchPrefs((s) => s.filter)
  const prefsReady = useSearchPrefs((s) => s.ready)
  useEffect(() => {
    useSearchPrefs.getState().load()
  }, [])

  const libraryFilter = useLibraryFilter((s) => s.filter)
  useEffect(() => {
    useLibraryFilter.getState().load()
    void useCollections.getState().load()
  }, [])

  const { status, error, sounds, totalCount, hasMore, loadingMore, loadMore } =
    useSearch(query, sort, filter, prefsReady)
  const library = useLibraryView(view === 'library', libraryFilter)
  const libraryFiltered = hasLibraryFilter(libraryFilter)

  const collection = useCollectionView(
    view === 'collections' && openCollection ? openCollection.id : null,
  )
  // Keep the open Collection's header count fresh as membership changes.
  const collectionsRevision = useCollections((s) => s.revision)
  const collectionsList = useCollections((s) => s.collections)
  useEffect(() => {
    if (!openCollection) return
    const fresh = collectionsList.find((c) => c.id === openCollection.id)
    if (!fresh) setOpenCollection(null)
    else if (fresh.name !== openCollection.name || fresh.count !== openCollection.count)
      setOpenCollection(fresh)
  }, [collectionsList, openCollection, collectionsRevision])

  const removeFromOpenCollection = useCallback(
    (sound: Sound) => {
      if (!openCollection) return
      useMultiSelect.getState().set(sound.id, false)
      void useCollections.getState().removeSound(openCollection.id, sound.id)
    },
    [openCollection],
  )

  const activeChips = activeFilterChips(filter)

  const focusSearch = useCallback(() => {
    const el = inputRef.current
    el?.focus()
    el?.select()
  }, [])

  // ArrowDown from the search box drops into the list at the first row.
  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && sounds.length > 0) {
      e.preventDefault()
      useResultSelection.getState().select(0, sounds[0]?.id ?? null)
    }
  }

  // Delete from the Library is destructive (it removes the downloaded file too),
  // so confirm first — a plain window.confirm is enough for v1.
  const confirmRemove = useCallback((sound: Sound) => {
    const ok = window.confirm(
      `Remove “${sound.name}” from your Library?\n\n` +
        'This also deletes the downloaded Original from this device. ' +
        'You can download it again from search later.',
    )
    if (ok) {
      useMultiSelect.getState().set(sound.id, false)
      void useLibrary.getState().remove(sound.id)
    }
  }, [])

  const showResults = view === 'search' && status === 'ok' && sounds.length > 0

  const tab = (v: View, label: string) => (
    <button
      type="button"
      onClick={() => {
        setView(v)
        useResultSelection.getState().clear()
        useMultiSelect.getState().clear()
        if (v !== 'collections') setOpenCollection(null)
      }}
      aria-pressed={view === v}
      className={[
        'rounded px-2 py-1 text-xs font-medium',
        view === v
          ? 'bg-neutral-800 text-neutral-100 ring-1 ring-inset ring-emerald-500'
          : 'text-neutral-400 hover:text-neutral-200',
      ].join(' ')}
    >
      {label}
    </button>
  )

  return (
    <main className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="shrink-0 border-b border-neutral-800 p-4">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">Freesound</h1>
            <div className="flex items-center gap-1">
              {tab('search', 'Search')}
              {tab('library', 'Library')}
              {tab('collections', 'Collections')}
            </div>
          </div>
          <div className="flex items-center gap-4">
            {showResults && (
              <span className="text-xs text-neutral-400" aria-live="polite">
                {formatResultCount(totalCount)}
              </span>
            )}
            {view === 'library' && library.status === 'ok' && (
              <span className="text-xs text-neutral-400" aria-live="polite">
                {library.sounds.length}{' '}
                {library.sounds.length === 1 ? 'sound' : 'sounds'}
              </span>
            )}
            {view === 'collections' &&
              openCollection &&
              collection.status === 'ok' && (
                <span className="text-xs text-neutral-400" aria-live="polite">
                  {collection.sounds.length}{' '}
                  {collection.sounds.length === 1 ? 'sound' : 'sounds'}
                </span>
              )}
            <AuthBar />
          </div>
        </div>

        {view === 'search' ? (
          <>
            <input
              ref={inputRef}
              type="search"
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-emerald-600 focus:outline-none"
              placeholder="Search sounds…  (press / to return here · press s to save the selected sound)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              autoFocus
            />
            <FilterBar />
          </>
        ) : view === 'library' ? (
          <>
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <span>Sorted by date saved</span>
              <button
                type="button"
                onClick={() =>
                  library.setDir(library.dir === 'desc' ? 'asc' : 'desc')
                }
                className="rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
              >
                {library.dir === 'desc' ? 'Newest first' : 'Oldest first'}
              </button>
              <span className="text-neutral-600">
                · select a row and press Delete to remove it · tick rows to add
                them to a collection
              </span>
            </div>
            <LibraryFilterBar />
          </>
        ) : (
          <div className="flex items-center gap-2 text-xs text-neutral-400">
            {openCollection ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setOpenCollection(null)
                    useResultSelection.getState().clear()
                    useMultiSelect.getState().clear()
                  }}
                  className="rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
                >
                  ‹ All collections
                </button>
                <span className="font-medium text-neutral-200">
                  {openCollection.name}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    collection.setDir(
                      collection.dir === 'desc' ? 'asc' : 'desc',
                    )
                  }
                  className="rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
                >
                  {collection.dir === 'desc'
                    ? 'Newest added first'
                    : 'Oldest added first'}
                </button>
                <span className="text-neutral-600">
                  · removing a sound here keeps it in your Library
                </span>
              </>
            ) : (
              <span>
                A collection is a named set of Library sounds. Collections do
                not nest.
              </span>
            )}
          </div>
        )}
      </header>

      <StagingConsentBanner />
      <RebuildBanner />

      <section className="min-h-0 flex-1">
        {view === 'search' && (
          <>
            {status === 'loading' && (
              <p className="p-4 text-sm text-neutral-400" aria-live="polite">
                Searching…
              </p>
            )}

            {status === 'error' && error && (
              <p className="p-4 text-sm text-red-400" role="alert">
                {error.kind === 'throttled'
                  ? `Rate-limited by Freesound${
                      error.retryAfter != null
                        ? ` — you can retry in about ${error.retryAfter}s`
                        : ''
                    }.`
                  : error.kind === 'network'
                    ? 'Search failed: no connection to Freesound.'
                    : `Search failed: ${error.message}`}
              </p>
            )}

            {status === 'ok' && sounds.length === 0 && (
              <div className="p-4 text-sm text-neutral-400">
                <p className="font-medium text-neutral-300">
                  Nothing matched “{query.trim()}”
                  {activeChips.length > 0 ? ' with these filters.' : '.'}
                </p>
                {activeChips.length > 0 ? (
                  <>
                    <p className="mt-1">
                      Try relaxing{' '}
                      {activeChips.length === 1 ? 'this filter' : 'one of these filters'}:
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {activeChips.map((c) => (
                        <button
                          key={c.keys.join(',')}
                          type="button"
                          onClick={() =>
                            c.keys.forEach((k) =>
                              useSearchPrefs.getState().removeFilter(k),
                            )
                          }
                          className="inline-flex items-center gap-1 rounded border border-amber-800/60 bg-amber-950/40 px-1.5 py-0.5 text-[11px] text-amber-200 hover:border-amber-600 hover:text-amber-100"
                          title="Remove this filter"
                        >
                          <span>{c.label}</span>
                          <span aria-hidden>×</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => useSearchPrefs.getState().clearFilter()}
                        className="rounded border border-neutral-700 px-1.5 py-0.5 text-[11px] text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
                      >
                        Clear all filters
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="mt-1">
                    Try fewer or more general words, or check the spelling.
                  </p>
                )}
              </div>
            )}

            {showResults && (
              <ResultList
                sounds={sounds}
                hasMore={hasMore}
                loadingMore={loadingMore}
                loadMore={loadMore}
                onFocusSearch={focusSearch}
              />
            )}
          </>
        )}

        {view === 'library' && (
          <div className="flex h-full flex-col">
            <AddToCollectionBar />
            {library.status === 'error' && (
              <p className="p-4 text-sm text-red-400" role="alert">
                Could not read the Library.
              </p>
            )}

            {library.status === 'ok' &&
              library.sounds.length === 0 &&
              (libraryFiltered ? (
                <div className="p-4 text-sm text-neutral-400">
                  <p className="font-medium text-neutral-300">
                    No Library sounds match this filter.
                  </p>
                  <button
                    type="button"
                    onClick={() => useLibraryFilter.getState().clearFilter()}
                    className="mt-2 rounded border border-neutral-700 px-1.5 py-0.5 text-[11px] text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
                  >
                    Clear all filters
                  </button>
                </div>
              ) : (
                <div className="p-4 text-sm text-neutral-400">
                  <p className="font-medium text-neutral-300">
                    Your Library is empty.
                  </p>
                  <p className="mt-1">
                    Search for a sound, select it, and press{' '}
                    <kbd className="rounded border border-neutral-700 px-1">
                      s
                    </kbd>{' '}
                    to keep it here.
                  </p>
                </div>
              ))}

            {library.sounds.length > 0 && (
              <div className="min-h-0 flex-1">
                <ResultList
                  sounds={library.sounds}
                  hasMore={false}
                  loadingMore={false}
                  loadMore={() => {}}
                  onFocusSearch={focusSearch}
                  variant="library"
                  onRemove={confirmRemove}
                />
              </div>
            )}
          </div>
        )}

        {view === 'collections' && !openCollection && (
          <div className="h-full overflow-auto">
            <CollectionsPanel onOpen={setOpenCollection} />
          </div>
        )}

        {view === 'collections' && openCollection && (
          <div className="flex h-full flex-col">
            <AddToCollectionBar />
            {collection.status === 'error' && (
              <p className="p-4 text-sm text-red-400" role="alert">
                Could not read this collection.
              </p>
            )}
            {collection.status === 'ok' && collection.sounds.length === 0 && (
              <div className="p-4 text-sm text-neutral-400">
                <p className="font-medium text-neutral-300">
                  “{openCollection.name}” has no sounds yet.
                </p>
                <p className="mt-1">
                  Add sounds from your Library (tick rows, then “Add to
                  collection”) or from a search result’s “＋ list” menu.
                </p>
              </div>
            )}
            {collection.sounds.length > 0 && (
              <div className="min-h-0 flex-1">
                <ResultList
                  sounds={collection.sounds}
                  hasMore={false}
                  loadingMore={false}
                  loadMore={() => {}}
                  onFocusSearch={focusSearch}
                  variant="collection"
                  onRemove={removeFromOpenCollection}
                  removeLabel="Remove from collection"
                  removeTitle="Remove from this collection — the sound stays in your Library"
                />
              </div>
            )}
          </div>
        )}
      </section>

      <TransportBar />
    </main>
  )
}
