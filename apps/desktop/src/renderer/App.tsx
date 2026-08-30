import { useCallback, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { AuthBar } from './components/AuthBar'
import { ResultList } from './components/ResultList'
import { StagingConsentBanner } from './components/StagingConsentBanner'
import { TransportBar } from './components/TransportBar'
import { useSearch } from './hooks/useSearch'
import { useLibraryView } from './hooks/useLibraryView'
import { formatResultCount } from './lib/format'
import { useResultSelection } from './store/useResultSelection'
import { useLibrary } from './store/useLibrary'
import type { Sound } from '../core/types'

type View = 'search' | 'library'

export default function App() {
  const [view, setView] = useState<View>('search')
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const { status, error, sounds, totalCount, hasMore, loadingMore, loadMore } =
    useSearch(query)
  const library = useLibraryView(view === 'library')

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
    if (ok) void useLibrary.getState().remove(sound.id)
  }, [])

  const showResults = view === 'search' && status === 'ok' && sounds.length > 0

  const tab = (v: View, label: string) => (
    <button
      type="button"
      onClick={() => {
        setView(v)
        useResultSelection.getState().clear()
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
            <AuthBar />
          </div>
        </div>

        {view === 'search' ? (
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
        ) : (
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
              · select a row and press Delete to remove it
            </span>
          </div>
        )}
      </header>

      <StagingConsentBanner />

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
                  Nothing matched “{query.trim()}”.
                </p>
                <p className="mt-1">
                  Try fewer or more general words, check the spelling, or drop a
                  filter.
                </p>
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
          <>
            {library.status === 'error' && (
              <p className="p-4 text-sm text-red-400" role="alert">
                Could not read the Library.
              </p>
            )}

            {library.status === 'ok' && library.sounds.length === 0 && (
              <div className="p-4 text-sm text-neutral-400">
                <p className="font-medium text-neutral-300">
                  Your Library is empty.
                </p>
                <p className="mt-1">
                  Search for a sound, select it, and press{' '}
                  <kbd className="rounded border border-neutral-700 px-1">s</kbd>{' '}
                  to keep it here.
                </p>
              </div>
            )}

            {library.sounds.length > 0 && (
              <ResultList
                sounds={library.sounds}
                hasMore={false}
                loadingMore={false}
                loadMore={() => {}}
                onFocusSearch={focusSearch}
                variant="library"
                onRemove={confirmRemove}
              />
            )}
          </>
        )}
      </section>

      <TransportBar />
    </main>
  )
}
