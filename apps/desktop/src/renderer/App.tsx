import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { AuthBar } from './components/AuthBar'
import { SignInGate } from './components/SignInGate'
import { FilterBar } from './components/FilterBar'
import { LibraryFilterBar } from './components/LibraryFilterBar'
import { ResultList } from './components/ResultList'
import { RebuildBanner } from './components/RebuildBanner'
import { DownloadQuota } from './components/DownloadQuota'
import { TransportBar } from './components/TransportBar'
import { CollectionsPanel } from './components/CollectionsPanel'
import { ManifestPanel } from './components/ManifestPanel'
import { AddToCollectionBar } from './components/AddToCollectionBar'
import { NotificationHost } from './components/NotificationHost'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { LogViewerDialog } from './components/LogViewerDialog'
import { SupportSplash } from './components/SupportSplash'
import { useNotifications } from './store/useNotifications'
import { useAuth } from './hooks/useAuth'
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
  const [showManifest, setShowManifest] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [showSupport, setShowSupport] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Ticket 18 — resume where the user left off. `uiReady` gates the first search
  // so a restored query does not flash an empty "search" state first, matching
  // how `prefsReady` gates the sort/filter restore.
  const [uiReady, setUiReady] = useState(false)
  const restore = useRef<{
    openCollectionId?: number | null
    selectedSoundId?: number | null
  }>({})
  useEffect(() => {
    let cancelled = false
    void window.core
      .getUiState()
      .then((s) => {
        if (cancelled) return
        if (s.view) setView(s.view as View)
        if (typeof s.query === 'string') setQuery(s.query)
        if (!s.supportPromptDismissed) setShowSupport(true)
        restore.current = {
          openCollectionId: s.openCollectionId ?? null,
          selectedSoundId: s.selectedSoundId ?? null,
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setUiReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Persist the shell state (debounced — `view`/`query`/open collection/selection
  // all funnel here). `setUiState` merges, so this never disturbs `window`.
  const selectedSoundId = useResultSelection((s) => s.selectedId)
  useEffect(() => {
    if (!uiReady) return
    const t = setTimeout(() => {
      void window.core.setUiState({
        view,
        query,
        openCollectionId: openCollection?.id ?? null,
        selectedSoundId: selectedSoundId ?? null,
      })
    }, 400)
    return () => clearTimeout(t)
  }, [uiReady, view, query, openCollection, selectedSoundId])

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

  // ADR-0004 — search runs on the user's OAuth token; there is no signed-out
  // search. Until signed in, the Search view shows <SignInGate/> and no query
  // fires. Library + Collections stay reachable (local-only).
  const authed = useAuth().state.status === 'signedIn'
  const { status, error, sounds, totalCount, hasMore, loadingMore, loadMore } =
    useSearch(query, sort, filter, prefsReady && uiReady && authed)
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

  // Ticket 18 — restore the Collection that was open last session, once the
  // list has loaded. One-shot: the restore ref is cleared after the attempt.
  useEffect(() => {
    if (!uiReady) return
    const want = restore.current.openCollectionId
    if (want == null) return
    if (collectionsList.length === 0) return
    const match = collectionsList.find((c) => c.id === want)
    if (match) setOpenCollection(match)
    restore.current.openCollectionId = null
  }, [uiReady, collectionsList])

  // Ticket 18 — put the row cursor back on the sound it was on. Best-effort:
  // attempted once per view's list as soon as that sound is present.
  const restoreListSounds =
    view === 'search'
      ? sounds
      : view === 'library'
        ? library.sounds
        : collection.sounds
  useEffect(() => {
    const want = restore.current.selectedSoundId
    if (want == null) return
    const idx = restoreListSounds.findIndex((s) => s.id === want)
    if (idx >= 0) {
      useResultSelection.getState().select(idx, want)
      restore.current.selectedSoundId = null
    }
  }, [restoreListSounds])

  // Ticket 18 — a search failure is not only inline text; it is also a
  // notification, so it reads the same as every other failure in the app and
  // lands in the log.
  useEffect(() => {
    if (status !== 'error' || !error) return
    useNotifications.getState().push(
      {
        kind:
          error.kind === 'throttled'
            ? 'throttled'
            : error.kind === 'network'
              ? 'network'
              : 'download',
        title:
          error.kind === 'throttled'
            ? 'Freesound rate limit hit'
            : error.kind === 'network'
              ? 'No connection to Freesound'
              : 'Search failed',
        detail:
          error.kind === 'throttled'
            ? `Too many requests. Try again in about ${error.retryAfter ?? 60}s.`
            : error.kind === 'network'
              ? 'Check your internet connection, then search again. Your Library still works offline.'
              : 'Freesound returned an error. This is on their side — try again later.',
        actionable: error.kind !== 'generic',
        retryAfter: error.retryAfter,
      },
      'search',
    )
  }, [status, error])

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

  // Ticket 18 — `?` opens the shortcut reference from anywhere except while
  // typing into a field. Esc closes whichever dialog is open.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing =
        !!el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable)
      if (e.key === '?' && !typing) {
        e.preventDefault()
        setShowShortcuts((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const showResults = view === 'search' && status === 'ok' && sounds.length > 0

  const tab = (v: View, label: string) => (
    <button
      type="button"
      onClick={() => {
        setView(v)
        useResultSelection.getState().clear()
        useMultiSelect.getState().clear()
        setShowManifest(false)
        if (v !== 'collections') setOpenCollection(null)
      }}
      aria-pressed={view === v}
      className={[
        'rounded px-2 py-1 text-xs font-medium',
        view === v
          ? 'bg-surface-raised text-ink ring-1 ring-inset ring-focus'
          : 'text-ink-muted hover:text-ink',
      ].join(' ')}
    >
      {label}
    </button>
  )

  return (
    <main className="flex h-screen flex-col bg-bg text-ink">
      <header className="shrink-0 border-b border-line p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-lg font-semibold">Super Duper Samples</h1>
            <div className="flex items-center gap-1">
              {tab('search', 'Search')}
              {tab('library', 'Library')}
              {tab('collections', 'Collections')}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {showResults && (
              <span className="text-xs text-ink-muted" aria-live="polite">
                {formatResultCount(totalCount)}
              </span>
            )}
            {view === 'library' && library.status === 'ok' && (
              <span className="text-xs text-ink-muted" aria-live="polite">
                {library.sounds.length}{' '}
                {library.sounds.length === 1 ? 'sound' : 'sounds'}
              </span>
            )}
            {view === 'collections' &&
              openCollection &&
              collection.status === 'ok' && (
                <span className="text-xs text-ink-muted" aria-live="polite">
                  {collection.sounds.length}{' '}
                  {collection.sounds.length === 1 ? 'sound' : 'sounds'}
                </span>
              )}
            <DownloadQuota />
            <AuthBar />
            <button
              type="button"
              onClick={() => setShowShortcuts(true)}
              title="Keyboard shortcuts (?)"
              aria-label="Keyboard shortcuts"
              className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-muted hover:border-line-strong hover:text-ink"
            >
              ?
            </button>
          </div>
        </div>

        {view === 'search' ? (
          authed ? (
            <>
              <input
                ref={inputRef}
                type="search"
                className="w-full rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-focus focus:outline-none"
                placeholder="Search sounds…  (press s to download the selected sound · ? for shortcuts)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                autoFocus
              />
              <FilterBar />
            </>
          ) : null
        ) : view === 'library' ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
              <span>Sorted by date saved</span>
              <button
                type="button"
                onClick={() =>
                  library.setDir(library.dir === 'desc' ? 'asc' : 'desc')
                }
                className="rounded border border-line px-1.5 py-0.5 text-ink-muted hover:border-line-strong hover:text-ink"
              >
                {library.dir === 'desc' ? 'Newest first' : 'Oldest first'}
              </button>
              <span className="text-ink-faint">
                · select a row and press Delete to remove it · tick rows to add
                them to a collection
              </span>
            </div>
            <LibraryFilterBar />
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            {openCollection ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setOpenCollection(null)
                    setShowManifest(false)
                    useResultSelection.getState().clear()
                    useMultiSelect.getState().clear()
                  }}
                  className="rounded border border-line px-1.5 py-0.5 text-ink-muted hover:border-line-strong hover:text-ink"
                >
                  ‹ All collections
                </button>
                <span className="font-medium text-ink">
                  {openCollection.name}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    collection.setDir(
                      collection.dir === 'desc' ? 'asc' : 'desc',
                    )
                  }
                  className="rounded border border-line px-1.5 py-0.5 text-ink-muted hover:border-line-strong hover:text-ink"
                >
                  {collection.dir === 'desc'
                    ? 'Newest added first'
                    : 'Oldest added first'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowManifest(true)}
                  className="rounded border border-accent-2 px-1.5 py-0.5 text-accent-2-text hover:bg-surface-raised"
                  title="Generate the attribution credits this collection owes"
                >
                  Generate manifest
                </button>
                <span className="text-ink-faint">
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

      <RebuildBanner />

      <section className="relative min-h-0 flex-1">
        {view === 'search' && !authed && <SignInGate />}
        {view === 'search' && authed && (
          <>
            {status === 'loading' && (
              <p className="p-4 text-sm text-ink-muted" aria-live="polite">
                Searching…
              </p>
            )}

            {status === 'error' && error && (
              <p className="p-4 text-sm text-error" role="alert">
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
              <div className="p-4 text-sm text-ink-muted">
                <p className="font-medium text-ink-muted">
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
                          className="inline-flex items-center gap-1 rounded border border-warn px-1.5 py-0.5 text-[11px] text-warn hover:bg-surface-raised"
                          title="Remove this filter"
                        >
                          <span>{c.label}</span>
                          <span aria-hidden>×</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => useSearchPrefs.getState().clearFilter()}
                        className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-muted hover:border-line-strong hover:text-ink"
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
                resetKey={`${query.trim()} ${sort} ${JSON.stringify(filter)}`}
              />
            )}
          </>
        )}

        {view === 'library' && (
          <div className="flex h-full flex-col">
            <AddToCollectionBar />
            {library.status === 'error' && (
              <p className="p-4 text-sm text-error" role="alert">
                Could not read the Library.
              </p>
            )}

            {library.status === 'ok' &&
              library.sounds.length === 0 &&
              (libraryFiltered ? (
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
              ) : (
                <div className="p-4 text-sm text-ink-muted">
                  <p className="font-medium text-ink-muted">
                    Your Library is empty.
                  </p>
                  <p className="mt-1">
                    Search for a sound, then press{' '}
                    <kbd className="rounded border border-line px-1">s</kbd> or
                    its <span className="font-medium">Download</span> button to
                    fetch the Original and keep it here.
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
              <p className="p-4 text-sm text-error" role="alert">
                Could not read this collection.
              </p>
            )}
            {collection.status === 'ok' && collection.sounds.length === 0 && (
              <div className="p-4 text-sm text-ink-muted">
                <p className="font-medium text-ink-muted">
                  “{openCollection.name}” has no sounds yet.
                </p>
                <p className="mt-1">
                  Add sounds from your Library — tick rows, then “Add to
                  collection”.
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
        {view === 'collections' && openCollection && showManifest && (
          <ManifestPanel
            collectionId={openCollection.id}
            collectionName={openCollection.name}
            onClose={() => setShowManifest(false)}
          />
        )}
      </section>

      <TransportBar />

      <NotificationHost />
      {showShortcuts && (
        <ShortcutsDialog
          onClose={() => setShowShortcuts(false)}
          onOpenLogs={() => {
            setShowShortcuts(false)
            setShowLogs(true)
          }}
        />
      )}
      {showLogs && <LogViewerDialog onClose={() => setShowLogs(false)} />}
      {showSupport && (
        <SupportSplash
          onDismiss={(dontShowAgain) => {
            setShowSupport(false)
            if (dontShowAgain)
              void window.core.setUiState({ supportPromptDismissed: true })
          }}
        />
      )}
    </main>
  )
}
