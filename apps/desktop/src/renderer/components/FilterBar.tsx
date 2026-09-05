import { memo } from 'react'
import type { ChangeEvent } from 'react'
import { useViewport } from '../lib/viewport'
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
  const { isRail } = useViewport()
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

  const sortSelect = (
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
  )

  const filterFields = (
    <>
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
    </>
  )

  return (
    <div className="mt-2 flex flex-col gap-2">
      {isRail ? (
        <div className="grid grid-cols-2 gap-2 text-xs text-ink-muted [&>span>div]:block [&>span>div>button]:w-full [&>span>div>button]:justify-between">
          <span className="min-w-0">{sortSelect}</span>
          <span className="min-w-0">
            <FilterPopover count={chips.length} onClearAll={clearFilter}>
              {filterFields}
            </FilterPopover>
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-ink-muted">
          <label className="flex items-center gap-1.5">
            <span>Sort</span>
            <span className="w-44">{sortSelect}</span>
          </label>

          <FilterPopover count={chips.length} onClearAll={clearFilter}>
            {filterFields}
          </FilterPopover>
        </div>
      )}

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
