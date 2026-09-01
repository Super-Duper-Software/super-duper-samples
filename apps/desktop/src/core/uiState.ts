// Persisted shell state (ticket 18): the window's size and position, and enough
// of the last session to "resume where the user left off" — the last view, the
// last search text, the open Collection, and the selected Sound.
//
// This is a plain value stored as a JSON blob in `app_meta` under `ui_state`,
// exactly like `search_prefs` (ticket 15). It is advisory: a corrupt or
// partial blob degrades to `EMPTY_UI_STATE` and never wedges startup. `src/main`
// reads `window` before creating the BrowserWindow; the renderer reads the rest
// on mount and writes patches back as the user navigates.

export type ShellView = 'search' | 'library' | 'collections' | 'edit'

export interface WindowBounds {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
}

export interface UiState {
  window?: WindowBounds
  view?: ShellView
  /** The last search text (search view only). */
  query?: string
  /** The Collection that was open, if the user was inside one. */
  openCollectionId?: number | null
  /** The Sound row that was selected, so the cursor lands back on it. */
  selectedSoundId?: number | null
  /**
   * The Library Sound open in the Edit view (ticket 07), so a restart lands
   * back in it when `view` is `'edit'`. `null`/absent outside the Edit view.
   */
  editSoundId?: number | null
  /**
   * Set once the user dismisses the Ko-fi support splash with "don't show
   * again" / "already donated". There is no way to detect a real donation
   * (Ko-fi only reports those server-side), so this is self-reported and
   * simply suppresses the splash on every later startup.
   */
  supportPromptDismissed?: boolean
}

export const EMPTY_UI_STATE: UiState = {}

/**
 * Smallest window we will restore to — a stored tiny/offscreen size is ignored.
 * The width floor is 360: the width the "rail" layout (spec 0003) is designed
 * against, below which the two-line result row and the segmented tab bar stop
 * working. The height floor is unchanged.
 */
export const MIN_WINDOW_WIDTH = 360
export const MIN_WINDOW_HEIGHT = 480

const VIEWS: readonly ShellView[] = ['search', 'library', 'collections', 'edit']

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function normaliseWindow(raw: unknown): WindowBounds | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const width = num(r['width'])
  const height = num(r['height'])
  if (width === undefined || height === undefined) return undefined
  if (width < MIN_WINDOW_WIDTH || height < MIN_WINDOW_HEIGHT) return undefined
  const out: WindowBounds = {
    width: Math.round(width),
    height: Math.round(height),
  }
  const x = num(r['x'])
  const y = num(r['y'])
  if (x !== undefined) out.x = Math.round(x)
  if (y !== undefined) out.y = Math.round(y)
  if (r['maximized'] === true) out.maximized = true
  return out
}

/**
 * Coerce anything (a parsed JSON blob, a renderer patch) into a valid `UiState`.
 * Unknown keys are dropped; an implausible window is dropped whole; a
 * non-string query becomes `undefined`.
 */
export function normaliseUiState(raw: unknown): UiState {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const out: UiState = {}

  const win = normaliseWindow(r['window'])
  if (win) out.window = win

  if (typeof r['view'] === 'string' && VIEWS.includes(r['view'] as ShellView)) {
    out.view = r['view'] as ShellView
  }
  if (typeof r['query'] === 'string') out.query = r['query'].slice(0, 512)

  const cid = r['openCollectionId']
  if (cid === null) out.openCollectionId = null
  else if (num(cid) !== undefined) out.openCollectionId = num(cid)

  const sid = r['selectedSoundId']
  if (sid === null) out.selectedSoundId = null
  else if (num(sid) !== undefined) out.selectedSoundId = num(sid)

  const eid = r['editSoundId']
  if (eid === null) out.editSoundId = null
  else if (num(eid) !== undefined) out.editSoundId = num(eid)

  if (r['supportPromptDismissed'] === true) out.supportPromptDismissed = true

  return out
}

/**
 * Fold a partial patch onto the current state. A key set to `undefined` in the
 * patch is a no-op (keep the old value); set it to `null` to clear an id. The
 * `window` object is replaced wholesale, not deep-merged.
 */
export function mergeUiState(current: UiState, patch: Partial<UiState>): UiState {
  const defined: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) defined[key] = value
  }
  return normaliseUiState({ ...current, ...defined })
}
