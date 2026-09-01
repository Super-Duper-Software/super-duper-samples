// Ticket 15 — the sort + filter controls under the search box. Sort stays inline
// (one control, always relevant); the six filter dimensions live behind a
// "Filters ▾" popover so the header stays one compact row. Below sits the row of
// removable "active filter" chips with a one-click "Clear all" — the always-
// visible summary of what is constraining the query.
//
// Presentation only: it reads and writes `useSearchPrefs`; `useSearch` reacts to
// that store and re-runs the query. Changing anything here never touches the
// query text.

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
import { FilterPopover } from './FilterPopover'
import { DurationRange, Field, StyledSelect } from './filterFields'

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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-ink-muted">
        <label className="flex items-center gap-1.5">
          <span>Sort</span>
          <span className="w-44">
            <StyledSelect
              aria-label="Sort results"
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </StyledSelect>
          </span>
        </label>

        <FilterPopover count={chips.length} onClearAll={clearFilter}>
          <Field label="Duration" wide>
            <DurationRange
              min={filter.durationMin}
              max={filter.durationMax}
              onMin={onNum('durationMin')}
              onMax={onNum('durationMax')}
            />
          </Field>

          <Field label="Sample rate">
            <StyledSelect
              aria-label="Sample rate"
              value={filter.sampleRate ?? ''}
              onChange={onNum('sampleRate')}
            >
              <option value="">Any</option>
              {SAMPLE_RATES.map((r) => (
                <option key={r} value={r}>
                  {r / 1000} kHz
                </option>
              ))}
            </StyledSelect>
          </Field>

          <Field label="Bit depth">
            <StyledSelect
              aria-label="Bit depth"
              value={filter.bitDepth ?? ''}
              onChange={onNum('bitDepth')}
            >
              <option value="">Any</option>
              {BIT_DEPTHS.map((b) => (
                <option key={b} value={b}>
                  {b}-bit
                </option>
              ))}
            </StyledSelect>
          </Field>

          <Field label="Channels">
            <StyledSelect
              aria-label="Channels"
              value={filter.channels ?? ''}
              onChange={onNum('channels')}
            >
              <option value="">Any</option>
              {CHANNEL_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </StyledSelect>
          </Field>

          <Field label="File type">
            <StyledSelect
              aria-label="File type"
              value={filter.fileType ?? ''}
              onChange={(e) => setFilter({ fileType: e.target.value || undefined })}
            >
              <option value="">Any</option>
              {FILE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.toUpperCase()}
                </option>
              ))}
            </StyledSelect>
          </Field>

          <Field label="License" wide>
            <StyledSelect
              aria-label="License"
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
            </StyledSelect>
          </Field>
        </FilterPopover>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          {chips.map((c) => (
            <button
              key={c.keys.join(',')}
              type="button"
              onClick={() => c.keys.forEach(removeFilter)}
              className="inline-flex items-center gap-1 rounded border border-accent-2 px-1.5 py-0.5 text-[11px] text-accent-2-text hover:bg-surface-raised"
              title="Remove this filter"
            >
              <span>{c.label}</span>
              <span aria-hidden>×</span>
            </button>
          ))}
          <button
            type="button"
            onClick={clearFilter}
            className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-muted hover:border-line-strong hover:text-ink"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  )
})
