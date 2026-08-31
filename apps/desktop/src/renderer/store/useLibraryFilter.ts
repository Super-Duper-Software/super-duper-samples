// The active Library filter (ticket 13).
//
// Same shape as ticket 15's `useSearchPrefs`: the truth lives in the core's
// `app_meta` table, this Zustand store is the renderer mirror. `load()` pulls the
// persisted filter on startup; every mutation updates the store AND fires
// `window.core.setLibraryFilter(...)` so the choice survives a restart. Changing
// the filter here does NOT run a query — `useLibraryView` watches this store and
// re-reads the Library itself (a database-only read, no network).

import { create } from 'zustand'
import type { LibraryFilter } from '../../preload'

export type LibraryFilterKey = keyof LibraryFilter

const EMPTY: LibraryFilter = {}

function persist(filter: LibraryFilter): void {
  try {
    void window.core?.setLibraryFilter?.(filter)?.catch?.(() => {})
  } catch {
    /* no bridge (tests) */
  }
}

/** Drop empty-ish entries so `{}` — not `{ text: '' }` — means "no filter". */
export function pruneLibraryFilter(filter: LibraryFilter): LibraryFilter {
  const out: LibraryFilter = { ...filter }
  if (out.tags && out.tags.length === 0) delete out.tags
  if (out.text != null && out.text.trim() === '') delete out.text
  for (const k of ['license', 'fileType'] as const) {
    if (out[k] === undefined || out[k] === null || out[k] === '') delete out[k]
  }
  for (const k of ['durationMin', 'durationMax'] as const) {
    if (out[k] === undefined || out[k] === null || Number.isNaN(out[k]))
      delete out[k]
  }
  return out
}

/** Whether the filter constrains anything at all. */
export function hasLibraryFilter(f: LibraryFilter): boolean {
  return (
    (f.tags?.length ?? 0) > 0 ||
    f.license != null ||
    f.durationMin != null ||
    f.durationMax != null ||
    (f.fileType != null && f.fileType !== '') ||
    (f.text != null && f.text.trim() !== '')
  )
}

export interface LibraryFilterState {
  /** False until the persisted filter has been read — `useLibraryView` waits on this. */
  ready: boolean
  filter: LibraryFilter
  load: () => void
  /** Merge a partial patch; `undefined` / `''` values remove that constraint. */
  setFilter: (patch: Partial<LibraryFilter>) => void
  /** Add one tag to the tag filter (de-duped, case-insensitively). */
  addTag: (tag: string) => void
  /** Remove one tag from the tag filter. */
  removeTag: (tag: string) => void
  /** Remove one constraint by key. */
  removeFilter: (key: LibraryFilterKey) => void
  /** Clear every constraint in one action. */
  clearFilter: () => void
}

export const useLibraryFilter = create<LibraryFilterState>((set, get) => ({
  ready: false,
  filter: EMPTY,

  load: () => {
    try {
      const p = window.core?.getLibraryFilter?.()
      if (!p) {
        set({ ready: true })
        return
      }
      void p
        .then((filter) =>
          set({ filter: pruneLibraryFilter(filter ?? {}), ready: true }),
        )
        .catch(() => set({ ready: true }))
    } catch {
      set({ ready: true })
    }
  },

  setFilter: (patch) => {
    const filter = pruneLibraryFilter({ ...get().filter, ...patch })
    set({ filter })
    persist(filter)
  },

  addTag: (tag) => {
    const t = tag.trim()
    if (!t) return
    const have = get().filter.tags ?? []
    if (have.some((x) => x.toLowerCase() === t.toLowerCase())) return
    const filter = pruneLibraryFilter({ ...get().filter, tags: [...have, t] })
    set({ filter })
    persist(filter)
  },

  removeTag: (tag) => {
    const have = get().filter.tags ?? []
    const next = have.filter((x) => x.toLowerCase() !== tag.toLowerCase())
    const filter = pruneLibraryFilter({ ...get().filter, tags: next })
    set({ filter })
    persist(filter)
  },

  removeFilter: (key) => {
    const filter = { ...get().filter }
    delete filter[key]
    set({ filter })
    persist(filter)
  },

  clearFilter: () => {
    set({ filter: {} })
    persist({})
  },
}))
