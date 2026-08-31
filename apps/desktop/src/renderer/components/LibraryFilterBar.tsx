// Ticket 13 — the Library filter controls, mirroring the ticket-15 search
// `FilterBar`. Presentation only: it reads and writes `useLibraryFilter`;
// `useLibraryView` reacts to that store and re-reads the Library from the
// database (no network). Filter state is shown as a row of removable chips with a
// one-click "Clear all", so it is always visible and easily cleared.

import { memo, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import type { LibraryFilter } from '../../preload'
import { useLibraryFilter, hasLibraryFilter } from '../store/useLibraryFilter'
import { FILE_TYPES, LICENSE_OPTIONS } from '../lib/filterLabels'

const FIELD =
  'rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-xs text-neutral-200 focus:border-emerald-600 focus:outline-none'

const numOrUndef = (v: string): number | undefined =>
  v === '' ? undefined : Number(v)

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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-neutral-400">
        <label className="flex items-center gap-1">
          <span>Find</span>
          <input
            type="search"
            placeholder="name, author, tag…"
            aria-label="Filter the Library by text"
            className={`${FIELD} w-48`}
            value={filter.text ?? ''}
            onChange={(e) => setFilter({ text: e.target.value || undefined })}
          />
        </label>

        <label className="flex items-center gap-1">
          <span>Tag</span>
          <input
            type="text"
            placeholder="add tag + Enter"
            aria-label="Add a tag to the Library filter"
            className={`${FIELD} w-32`}
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={onTagKeyDown}
            onBlur={commitTag}
          />
        </label>

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
              license: (e.target.value ||
                undefined) as LibraryFilter['license'],
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
              className="inline-flex items-center gap-1 rounded border border-emerald-800/60 bg-emerald-950/50 px-1.5 py-0.5 text-[11px] text-emerald-200 hover:border-emerald-600 hover:text-emerald-100"
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
            className="rounded border border-neutral-700 px-1.5 py-0.5 text-[11px] text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
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
      className="inline-flex items-center gap-1 rounded border border-emerald-800/60 bg-emerald-950/50 px-1.5 py-0.5 text-[11px] text-emerald-200 hover:border-emerald-600 hover:text-emerald-100"
      title="Remove this filter"
    >
      <span>{label}</span>
      <span aria-hidden>×</span>
    </button>
  )
}
