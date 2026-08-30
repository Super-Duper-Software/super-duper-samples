// The active sort + filter state for search (ticket 15).
//
// The truth lives in the core's `app_meta` table — this Zustand store is a
// renderer mirror. `load()` pulls the persisted prefs on startup; every mutation
// updates the store AND fires `window.core.setSearchPrefs(...)` so the choice
// survives an app restart. Changing sort/filter here does NOT run a search:
// `useSearch` watches this store and re-runs the current query itself, which is
// what keeps the query text (owned by `App`) untouched.

import { create } from 'zustand'
import type { SearchFilter, SearchPrefs, SearchSort } from '../../preload'

export type FilterKey = keyof SearchFilter

const NEUTRAL: SearchPrefs = { sort: 'relevance', filter: {} }

function persist(sort: SearchSort, filter: SearchFilter): void {
  try {
    void window.core?.setSearchPrefs?.({ sort, filter })?.catch?.(() => {})
  } catch {
    /* no bridge (tests) */
  }
}

/** Drop empty-ish entries so `{}` — not `{ fileType: '' }` — means "no filter". */
function prune(filter: SearchFilter): SearchFilter {
  const out: SearchFilter = { ...filter }
  for (const k of Object.keys(out) as FilterKey[]) {
    const v = out[k]
    if (v === undefined || v === null || v === '') delete out[k]
  }
  return out
}

export interface SearchPrefsState {
  /** False until the persisted prefs have been read — `useSearch` waits on this. */
  ready: boolean
  sort: SearchSort
  filter: SearchFilter
  load: () => void
  setSort: (sort: SearchSort) => void
  /** Merge a partial patch; `undefined` / `''` values remove that constraint. */
  setFilter: (patch: Partial<SearchFilter>) => void
  /** Remove one constraint by key. */
  removeFilter: (key: FilterKey) => void
  /** Clear every filter in one action; sort is left as-is. */
  clearFilter: () => void
}

export const useSearchPrefs = create<SearchPrefsState>((set, get) => ({
  ready: false,
  sort: NEUTRAL.sort,
  filter: NEUTRAL.filter,

  load: () => {
    try {
      const p = window.core?.getSearchPrefs?.()
      if (!p) {
        set({ ready: true })
        return
      }
      void p
        .then((prefs) =>
          set({
            sort: prefs.sort ?? 'relevance',
            filter: prune(prefs.filter ?? {}),
            ready: true,
          }),
        )
        .catch(() => set({ ready: true }))
    } catch {
      set({ ready: true })
    }
  },

  setSort: (sort) => {
    set({ sort })
    persist(sort, get().filter)
  },

  setFilter: (patch) => {
    const filter = prune({ ...get().filter, ...patch })
    set({ filter })
    persist(get().sort, filter)
  },

  removeFilter: (key) => {
    const filter = { ...get().filter }
    delete filter[key]
    set({ filter })
    persist(get().sort, filter)
  },

  clearFilter: () => {
    set({ filter: {} })
    persist(get().sort, {})
  },
}))
