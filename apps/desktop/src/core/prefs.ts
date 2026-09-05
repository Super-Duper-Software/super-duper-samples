import type { DB } from './db/index'
import { getMeta, setMeta, UI_STATE_KEY } from './db/appMeta'
import type { LibraryFilter, SearchPrefs } from './types'
import { normaliseLibraryFilter } from './library/libraryFilter'
import { normalizeFilter } from './search/normalise'
import { EMPTY_UI_STATE, normaliseUiState, type UiState } from './uiState'

const SEARCH_PREFS_KEY = 'search_prefs'
const LIBRARY_FILTER_KEY = 'library_filter'

const NEUTRAL_PREFS: SearchPrefs = { sort: 'relevance', filter: {} }

/**
 * Read the persisted sort + filter. Absence or a corrupt blob falls back to the
 * neutral prefs — bad stored state must never wedge search.
 */
export function readSearchPrefs(db: DB): SearchPrefs {
  const raw = getMeta(db, SEARCH_PREFS_KEY)
  if (!raw) return { ...NEUTRAL_PREFS, filter: {} }
  try {
    const parsed = JSON.parse(raw) as Partial<SearchPrefs>
    return {
      sort: parsed.sort ?? 'relevance',
      filter: normalizeFilter(parsed.filter) ?? {},
    }
  } catch {
    return { ...NEUTRAL_PREFS, filter: {} }
  }
}

export function writeSearchPrefs(db: DB, prefs: SearchPrefs): SearchPrefs {
  const clean: SearchPrefs = {
    sort: prefs.sort ?? 'relevance',
    filter: normalizeFilter(prefs.filter) ?? {},
  }
  setMeta(db, SEARCH_PREFS_KEY, JSON.stringify(clean))
  return clean
}

/** Read the persisted Library filter; a corrupt blob falls back to the empty filter. */
export function readLibraryFilter(db: DB): LibraryFilter {
  const raw = getMeta(db, LIBRARY_FILTER_KEY)
  if (!raw) return {}
  try {
    return normaliseLibraryFilter(JSON.parse(raw) as LibraryFilter)
  } catch {
    return {}
  }
}

export function writeLibraryFilter(
  db: DB,
  filter: LibraryFilter,
): LibraryFilter {
  const clean = normaliseLibraryFilter(filter)
  setMeta(db, LIBRARY_FILTER_KEY, JSON.stringify(clean))
  return clean
}

/** Read the persisted shell state; a corrupt blob must never stop the app opening. */
export function readUiState(db: DB): UiState {
  const raw = getMeta(db, UI_STATE_KEY)
  if (!raw) return { ...EMPTY_UI_STATE }
  try {
    return normaliseUiState(JSON.parse(raw))
  } catch {
    return { ...EMPTY_UI_STATE }
  }
}

export function writeUiState(db: DB, next: UiState): UiState {
  setMeta(db, UI_STATE_KEY, JSON.stringify(next))
  return next
}
