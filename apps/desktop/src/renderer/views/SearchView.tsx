import { ResultList } from '../components/ResultList'
import { SignInGate } from '../components/SignInGate'
import type { UseSearch } from '../hooks/useSearch'
import { activeFilterChips } from '../lib/filterLabels'
import { useViewport } from '../lib/viewport'
import { useSearchPrefs } from '../store/useSearchPrefs'
import type { SearchFilter, SearchSort } from '../../core/types'

export interface SearchViewProps {
  authed: boolean
  query: string
  sort: SearchSort
  filter: SearchFilter
  search: UseSearch
  resultCountText: string | null
  onFocusSearch: () => void
}

/** "Nothing matched" — with the active filters offered up for removal. */
function EmptyResults({ query, filter }: { query: string; filter: SearchFilter }) {
  const chips = activeFilterChips(filter)
  return (
    <div className="p-4 text-sm text-ink-muted">
      <p className="font-medium text-ink-muted">
        Nothing matched “{query.trim()}”
        {chips.length > 0 ? ' with these filters.' : '.'}
      </p>
      {chips.length > 0 ? (
        <>
          <p className="mt-1">
            Try relaxing{' '}
            {chips.length === 1 ? 'this filter' : 'one of these filters'}:
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <button
                key={c.keys.join(',')}
                type="button"
                onClick={() =>
                  c.keys.forEach((k) => useSearchPrefs.getState().removeFilter(k))
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
  )
}

function SearchError({ error }: { error: NonNullable<UseSearch['error']> }) {
  return (
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
  )
}

export function SearchView({
  authed,
  query,
  sort,
  filter,
  search,
  resultCountText,
  onFocusSearch,
}: SearchViewProps) {
  const { isRail } = useViewport()
  if (!authed) return <SignInGate />

  const { status, error, sounds, hasMore, loadingMore, loadMore } = search

  return (
    <>
      {status === 'loading' && (
        <p className="p-4 text-sm text-ink-muted" aria-live="polite">
          Searching…
        </p>
      )}

      {status === 'error' && error && <SearchError error={error} />}

      {status === 'ok' && sounds.length === 0 && (
        <EmptyResults query={query} filter={filter} />
      )}

      {status === 'ok' && sounds.length > 0 && (
        <ResultList
          sounds={sounds}
          hasMore={hasMore}
          loadingMore={loadingMore}
          loadMore={loadMore}
          onFocusSearch={onFocusSearch}
          topSlot={isRail ? resultCountText : undefined}
          resetKey={`${query.trim()} ${sort} ${JSON.stringify(filter)}`}
        />
      )}
    </>
  )
}
