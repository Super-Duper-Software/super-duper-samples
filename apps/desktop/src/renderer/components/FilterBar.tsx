// Ticket 15 — the sort + filter controls under the search box, plus the row of
// removable "active filter" chips and a one-click "Clear all". Presentation only:
// it reads and writes `useSearchPrefs`; `useSearch` reacts to that store and
// re-runs the query. Changing anything here never touches the query text.

import { memo } from 'react'
import type { ChangeEvent } from 'react'
import { useSearchPrefs } from '../store/useSearchPrefs'
import type { SearchFilter } from '../../preload'
import {
  activeFilterChips,
  BIT_DEPTHS,
  CHANNEL_OPTIONS,
  FILE_TYPES,
  LICENSE_OPTIONS,
  SAMPLE_RATES,
  SORT_OPTIONS,
} from '../lib/filterLabels'

const FIELD =
  'rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-xs text-neutral-200 focus:border-emerald-600 focus:outline-none'

const numOrUndef = (v: string): number | undefined =>
  v === '' ? undefined : Number(v)

export const FilterBar = memo(function FilterBar() {
  const sort = useSearchPrefs((s) => s.sort)
  const filter = useSearchPrefs((s) => s.filter)
  const setSort = useSearchPrefs((s) => s.setSort)
  const setFilter = useSearchPrefs((s) => s.setFilter)
  const removeFilter = useSearchPrefs((s) => s.removeFilter)
  const clearFilter = useSearchPrefs((s) => s.clearFilter)

  const chips = activeFilterChips(filter)

  const onNum =
    (key: 'durationMin' | 'durationMax' | 'sampleRate' | 'bitDepth' | 'channels') =>
    (e: ChangeEvent<HTMLSelectElement | HTMLInputElement>) =>
      setFilter({ [key]: numOrUndef(e.target.value) } as Partial<SearchFilter>)

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-neutral-400">
        <label className="flex items-center gap-1">
          <span>Sort</span>
          <select
            className={FIELD}
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <span className="text-neutral-700" aria-hidden>
          |
        </span>

        <label className="flex items-center gap-1">
          <span>Duration</span>
          <input
            type="number"
            min={0}
            step="0.1"
            inputMode="decimal"
            placeholder="min"
            aria-label="Minimum duration in seconds"
            className={`${FIELD} w-16`}
            value={filter.durationMin ?? ''}
            onChange={onNum('durationMin')}
          />
          <span aria-hidden>–</span>
          <input
            type="number"
            min={0}
            step="0.1"
            inputMode="decimal"
            placeholder="max"
            aria-label="Maximum duration in seconds"
            className={`${FIELD} w-16`}
            value={filter.durationMax ?? ''}
            onChange={onNum('durationMax')}
          />
          <span>s</span>
        </label>

        <select
          aria-label="Sample rate"
          className={FIELD}
          value={filter.sampleRate ?? ''}
          onChange={onNum('sampleRate')}
        >
          <option value="">Any sample rate</option>
          {SAMPLE_RATES.map((r) => (
            <option key={r} value={r}>
              {r / 1000} kHz
            </option>
          ))}
        </select>

        <select
          aria-label="Bit depth"
          className={FIELD}
          value={filter.bitDepth ?? ''}
          onChange={onNum('bitDepth')}
        >
          <option value="">Any bit depth</option>
          {BIT_DEPTHS.map((b) => (
            <option key={b} value={b}>
              {b}-bit
            </option>
          ))}
        </select>

        <select
          aria-label="Channels"
          className={FIELD}
          value={filter.channels ?? ''}
          onChange={onNum('channels')}
        >
          <option value="">Any channels</option>
          {CHANNEL_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>

        <select
          aria-label="File type"
          className={FIELD}
          value={filter.fileType ?? ''}
          onChange={(e) => setFilter({ fileType: e.target.value || undefined })}
        >
          <option value="">Any file type</option>
          {FILE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.toUpperCase()}
            </option>
          ))}
        </select>

        <select
          aria-label="License"
          className={FIELD}
          value={filter.license ?? ''}
          onChange={(e) =>
            setFilter({
              license: (e.target.value || undefined) as SearchFilter['license'],
            })
          }
        >
          <option value="">Any license</option>
          {LICENSE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          {chips.map((c) => (
            <button
              key={c.keys.join(',')}
              type="button"
              onClick={() => c.keys.forEach(removeFilter)}
              className="inline-flex items-center gap-1 rounded border border-emerald-800/60 bg-emerald-950/50 px-1.5 py-0.5 text-[11px] text-emerald-200 hover:border-emerald-600 hover:text-emerald-100"
              title="Remove this filter"
            >
              <span>{c.label}</span>
              <span aria-hidden>×</span>
            </button>
          ))}
          <button
            type="button"
            onClick={clearFilter}
            className="rounded border border-neutral-700 px-1.5 py-0.5 text-[11px] text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  )
})
