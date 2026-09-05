import type { KeyboardEvent, RefObject } from 'react'
import { FilterBar } from '../components/FilterBar'
import { LibraryFilterBar } from '../components/LibraryFilterBar'
import { useViewport } from '../lib/viewport'
import { useMultiSelect } from '../store/useMultiSelect'
import { useResultSelection } from '../store/useResultSelection'
import type { ShellState } from './useShellState'

type SortDir = 'asc' | 'desc'

/** A sort-direction toggle that collapses to an arrow on a narrow window. */
function SortToggle({
  dir,
  onToggle,
  descLabel,
  ascLabel,
}: {
  dir: SortDir
  onToggle: () => void
  descLabel: string
  ascLabel: string
}) {
  const { isRail } = useViewport()
  const label = dir === 'desc' ? descLabel : ascLabel
  return (
    <button
      type="button"
      onClick={onToggle}
      className="rounded border border-line px-1.5 py-0.5 text-ink-muted hover:border-line-strong hover:text-ink"
      title={label}
      aria-label={`Sort direction: ${label.toLowerCase()}`}
    >
      {isRail ? (dir === 'desc' ? '↓' : '↑') : label}
    </button>
  )
}

export interface ContextBarProps {
  shell: ShellState
  authed: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onSearchKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  libraryDir: SortDir
  setLibraryDir: (dir: SortDir) => void
  collectionDir: SortDir
  setCollectionDir: (dir: SortDir) => void
}

/** The header's second row: whatever the active view needs to steer its list. */
export function ContextBar({
  shell,
  authed,
  inputRef,
  onSearchKeyDown,
  libraryDir,
  setLibraryDir,
  collectionDir,
  setCollectionDir,
}: ContextBarProps) {
  if (shell.view === 'search') {
    if (!authed) return null
    return (
      <>
        <input
          ref={inputRef}
          type="search"
          className="w-full rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-focus focus:outline-none"
          placeholder="Search sounds…  (press s to download the selected sound · ? for shortcuts)"
          value={shell.query}
          onChange={(e) => shell.setQuery(e.target.value)}
          onKeyDown={onSearchKeyDown}
          autoFocus
        />
        <FilterBar />
      </>
    )
  }

  if (shell.view === 'library') {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <span>Sorted by date saved</span>
          <SortToggle
            dir={libraryDir}
            onToggle={() => setLibraryDir(libraryDir === 'desc' ? 'asc' : 'desc')}
            descLabel="Newest first"
            ascLabel="Oldest first"
          />
        </div>
        <LibraryFilterBar />
      </>
    )
  }

  const { openCollection } = shell
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
      {openCollection ? (
        <>
          <button
            type="button"
            onClick={() => {
              shell.setOpenCollection(null)
              shell.setShowManifest(false)
              useResultSelection.getState().clear()
              useMultiSelect.getState().clear()
            }}
            className="rounded border border-line px-1.5 py-0.5 text-ink-muted hover:border-line-strong hover:text-ink"
          >
            ‹ All collections
          </button>
          <span className="font-medium text-ink">{openCollection.name}</span>
          <SortToggle
            dir={collectionDir}
            onToggle={() =>
              setCollectionDir(collectionDir === 'desc' ? 'asc' : 'desc')
            }
            descLabel="Newest added first"
            ascLabel="Oldest added first"
          />
          <button
            type="button"
            onClick={() => shell.setShowManifest(true)}
            className="rounded border border-accent-2 px-1.5 py-0.5 text-accent-2-text hover:bg-surface-raised"
            title="Generate the attribution credits this collection owes"
          >
            Credits
          </button>
        </>
      ) : (
        <span>
          A collection is a named set of Library sounds. Collections do not nest.
        </span>
      )}
    </div>
  )
}
