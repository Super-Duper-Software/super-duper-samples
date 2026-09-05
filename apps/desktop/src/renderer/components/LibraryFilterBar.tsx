import { memo, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import type { LibraryFilter } from '../../preload'
import { useLibraryFilter, hasLibraryFilter } from '../store/useLibraryFilter'
import { FILE_TYPES, LICENSE_OPTIONS } from '../lib/filterLabels'
import { FilterPopover } from './FilterPopover'
import {
  DurationRange,
  Field,
  FILTER_CONTROL_CLASS,
  StyledSelect,
} from './filterFields'

const numOrUndef = (v: string): number | undefined =>
  v === '' ? undefined : Number(v)

/** Count of active constraints — drives the popover badge. */
function filterCount(f: LibraryFilter): number {
  let n = 0
  if ((f.tags?.length ?? 0) > 0) n += f.tags!.length
  if (f.durationMin != null || f.durationMax != null) n += 1
  if (f.fileType) n += 1
  if (f.license) n += 1
  return n
}

export const LibraryFilterBar = memo(function LibraryFilterBar() {
  const filter = useLibraryFilter((s) => s.filter)
  const setFilter = useLibraryFilter((s) => s.setFilter)
  const addTag = useLibraryFilter((s) => s.addTag)
  const removeTag = useLibraryFilter((s) => s.removeTag)
  const removeFilter = useLibraryFilter((s) => s.removeFilter)
  const clearFilter = useLibraryFilter((s) => s.clearFilter)

  const [tagDraft, setTagDraft] = useState('')

  const onNum =
    (key: 'durationMin' | 'durationMax') =>
    (e: ChangeEvent<HTMLInputElement>) =>
      setFilter({
        [key]: numOrUndef(e.target.value),
      } as Partial<LibraryFilter>)

  const commitTag = () => {
    const t = tagDraft.trim()
    if (!t) return
    addTag(t)
    setTagDraft('')
  }

  const onTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commitTag()
    }
  }

  const tags = filter.tags ?? []
  const active = hasLibraryFilter(filter)

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-ink-muted">
        <label className="flex items-center gap-1.5">
          <span>Find</span>
          <input
            type="search"
            placeholder="name, author, tag…"
            aria-label="Filter the Library by text"
            className={`${FILTER_CONTROL_CLASS} w-56`}
            value={filter.text ?? ''}
            onChange={(e) => setFilter({ text: e.target.value || undefined })}
          />
        </label>

        <FilterPopover count={filterCount(filter)} onClearAll={clearFilter}>
          <Field label="Add tag" wide>
            <input
              type="text"
              placeholder="type a tag, press Enter"
              aria-label="Add a tag to the Library filter"
              className={FILTER_CONTROL_CLASS}
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={onTagKeyDown}
              onBlur={commitTag}
            />
          </Field>

          <Field label="Duration" wide>
            <DurationRange
              min={filter.durationMin}
              max={filter.durationMax}
              onMin={onNum('durationMin')}
              onMax={onNum('durationMax')}
            />
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

          <Field label="License">
            <StyledSelect
              aria-label="License"
              value={filter.license ?? ''}
              onChange={(e) =>
                setFilter({
                  license: (e.target.value ||
                    undefined) as LibraryFilter['license'],
                })
              }
            >
              <option value="">Any</option>
              {LICENSE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </StyledSelect>
          </Field>
        </FilterPopover>
      </div>

      {active && (
        <div
          className="flex flex-wrap items-center gap-1.5"
          aria-label="Active Library filters"
        >
          {tags.map((t) => (
            <button
              key={`tag:${t}`}
              type="button"
              onClick={() => removeTag(t)}
              className="inline-flex items-center gap-1 rounded border border-accent-2 px-1.5 py-0.5 text-[11px] text-accent-2-text hover:bg-surface-raised"
              title="Remove this tag filter"
            >
              <span># {t}</span>
              <span aria-hidden>×</span>
            </button>
          ))}
          {filter.text && (
            <FilterPill
              label={`“${filter.text}”`}
              onRemove={() => removeFilter('text')}
            />
          )}
          {(filter.durationMin != null || filter.durationMax != null) && (
            <FilterPill
              label={`Duration ${filter.durationMin ?? 0}s–${
                filter.durationMax != null ? `${filter.durationMax}s` : '∞'
              }`}
              onRemove={() => {
                removeFilter('durationMin')
                removeFilter('durationMax')
              }}
            />
          )}
          {filter.fileType && (
            <FilterPill
              label={filter.fileType.toUpperCase()}
              onRemove={() => removeFilter('fileType')}
            />
          )}
          {filter.license && (
            <FilterPill
              label={
                LICENSE_OPTIONS.find((o) => o.value === filter.license)
                  ?.label ?? String(filter.license)
              }
              onRemove={() => removeFilter('license')}
            />
          )}
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

function FilterPill({
  label,
  onRemove,
}: {
  label: string
  onRemove: () => void
}) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="inline-flex items-center gap-1 rounded border border-accent-2 px-1.5 py-0.5 text-[11px] text-accent-2-text hover:bg-surface-raised"
      title="Remove this filter"
    >
      <span>{label}</span>
      <span aria-hidden>×</span>
    </button>
  )
}
