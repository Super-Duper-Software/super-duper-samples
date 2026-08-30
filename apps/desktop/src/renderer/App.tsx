import { useCallback, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ResultList } from './components/ResultList'
import { useSearch } from './hooks/useSearch'
import { formatResultCount } from './lib/format'
import { useResultSelection } from './store/useResultSelection'

export default function App() {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const { status, error, sounds, totalCount, hasMore, loadingMore, loadMore } =
    useSearch(query)

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

  const showResults = status === 'ok' && sounds.length > 0

  return (
    <main className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="shrink-0 border-b border-neutral-800 p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h1 className="text-lg font-semibold">Freesound</h1>
          {showResults && (
            <span className="text-xs text-neutral-400" aria-live="polite">
              {formatResultCount(totalCount)}
            </span>
          )}
        </div>

        <input
          ref={inputRef}
          type="search"
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-emerald-600 focus:outline-none"
          placeholder="Search sounds…  (press / to return here)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          autoFocus
        />
      </header>

      <section className="min-h-0 flex-1">
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
            <p className="font-medium text-neutral-300">Nothing matched “{query.trim()}”.</p>
            <p className="mt-1">
              Try fewer or more general words, check the spelling, or drop a filter.
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
      </section>
    </main>
  )
}
