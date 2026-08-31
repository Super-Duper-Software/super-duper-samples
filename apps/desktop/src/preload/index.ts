// The contextBridge surface. This IS the IPC contract: it forwards the core's
// command API verbatim to the renderer and adds nothing of its own. Later tickets
// extend `CoreApi` in lockstep with the core's `Core` interface.

import { contextBridge, ipcRenderer } from 'electron'
import type {
  AuthState,
  DiskUsage,
  EvictionOutcome,
  PeaksPayload,
  PeaksStatusChange,
  StagingConsent,
  StagingStatus,
  StagingStatusChange,
} from '../core'
import type {
  SearchOptions,
  SearchPrefs,
  SearchResult,
  Sound,
} from '../core/types'
import type { SortDir } from '../core'

export type {
  LicenseFilter,
  SearchFilter,
  SearchOptions,
  SearchPrefs,
  SearchResult,
  SearchSort,
} from '../core/types'

export type {
  AuthState,
  DiskUsage,
  EvictionOutcome,
  PeaksPayload,
  PeaksStatusChange,
  StagingConsent,
  StagingStatus,
  StagingStatusChange,
} from '../core'

/** Channel the main process pushes auth-state transitions on (ticket 07). */
const AUTH_STATE_CHANNEL = 'core:event:authState'
/** Channel the main process pushes per-sound staging status changes on (ticket 08). */
const STAGING_STATUS_CHANNEL = 'core:event:stagingStatus'
/** Channel the main process pushes per-sound computed-peaks status changes on (ticket 12). */
const PEAKS_STATUS_CHANNEL = 'core:event:peaksStatus'

export interface CoreApi {
  search(query: string, opts?: SearchOptions): Promise<SearchResult>
  /** Debounced search — rapid keystrokes collapse to one gateway call (ticket 05). */
  searchDebounced(query: string, opts?: SearchOptions): Promise<SearchResult>

  // ---- search filters & sort (ticket 15) --------------------------------
  /** The persisted active sort + filter state, restored on startup. */
  getSearchPrefs(): Promise<SearchPrefs>
  /** Persist the active sort + filter state. Does not run a search. */
  setSearchPrefs(prefs: SearchPrefs): Promise<SearchPrefs>

  // ---- auth (ticket 07) --------------------------------------------------
  /** Start interactive sign-in via the system browser. Resolves to the new state. */
  signIn(): Promise<AuthState>
  /** Sign out. Clears stored tokens only — the Library is untouched. */
  signOut(): Promise<void>
  /** Read the current auth state (`signedIn` / `signedOut` / `signingIn` + `username`). */
  getAuthState(): Promise<AuthState>
  /**
   * Subscribe to auth-state pushes from the core. Returns an unsubscribe
   * function. Fires on every transition and once on window load.
   */
  onAuthState(listener: (state: AuthState) => void): () => void

  // ---- staging (ticket 08) --------------------------------------------
  /** Enqueue a background download of a Sound's Original (called on audition). Fire-and-forget. */
  stageOnAudition(soundId: number): Promise<void>
  /** Cancel a sound's queued/in-flight staged download. */
  cancelStaging(soundId: number): Promise<void>
  /** Per-sound staging status for the row indicators. */
  getStagingStatus(ids: number[]): Promise<Record<number, StagingStatus>>
  /** Whether the first-run staging notice was acknowledged. */
  getStagingConsent(): Promise<StagingConsent>
  /** Record acknowledgement of the first-run staging notice. */
  grantStagingConsent(): Promise<StagingConsent>
  /** Subscribe to per-sound staging status pushes. Returns an unsubscribe function. */
  onStagingStatus(listener: (change: StagingStatusChange) => void): () => void

  // ---- drag-out (ticket 09) -----------------------------------------
  /**
   * Begin an OS drag-out of one or more Sounds. Call from the row's `dragstart`
   * handler after `event.preventDefault()`. `iconDataUrl` is a PNG of the Sound's
   * rendered waveform for the drag image (optional — a bundled glyph is used
   * otherwise). Rejects with `OriginalNotStagedError`'s message if a Sound's
   * Original is not yet on disk — show it; never fall back to a Preview.
   */
  startDrag(
    soundIds: number | number[],
    opts?: { iconDataUrl?: string },
  ): Promise<{
    filePath: string
    extraFilePaths: string[]
    soundIds: number[]
  }>
  /** Whether the UI may offer multi-Sound drag on this platform (macOS only for now). */
  getDragCapabilities(): Promise<{ multiSound: boolean }>
  /**
   * Signal that an OS drag-out of these Sounds has ended (call from `dragend`,
   * whatever the outcome). Releases the eviction hold `startDrag` placed on each
   * Sound's Original.
   */
  endDrag(soundIds: number | number[]): Promise<void>

  // ---- eviction & disk usage (ticket 10) ----------------------------
  /** On-disk footprint in bytes, split into `staged` / `library` / `total`. */
  getDiskUsage(): Promise<DiskUsage>
  /**
   * Delete every Staged Original + sidecar + row to reclaim space now. The
   * Library is untouched; Sounds with a live Drag-Out are skipped.
   */
  clearStaged(): Promise<EvictionOutcome>

  // ---- library (ticket 11) ----------------------------------------
  /**
   * Save a Sound to the Library (a single-keystroke action in the renderer).
   * Instant: writes one DB row, never moves or copies the file. Idempotent.
   * Pass the `Sound` so the core can persist its metadata if needed.
   */
  saveToLibrary(soundId: number, sound?: Sound): Promise<void>
  /** Batch "already in the Library?" for search-result badges. */
  getLibraryMembership(ids: number[]): Promise<Record<number, boolean>>
  /** The Library as `Sound[]`, newest-saved first by default. No gateway call. */
  listLibrary(opts?: { sort?: 'savedAt'; dir?: SortDir }): Promise<Sound[]>
  /**
   * Remove a Sound from the Library: drops its row AND deletes its Original +
   * sidecar to reclaim disk. The renderer confirms with the user first.
   */
  deleteFromLibrary(soundId: number): Promise<void>
  /**
   * Reveal a Library Sound's Original in Finder / Explorer (main-process
   * `shell.showItemInFolder`). No-op if the Original is not on disk.
   */
  revealInFinder(soundId: number): Promise<void>
  /**
   * Open a Sound's page on freesound.org in the system browser (main-process
   * `shell.openExternal`).
   */
  openFreesoundPage(soundId: number): Promise<void>

  // ---- computed peaks & canvas waveform (ticket 12) ---------------
  /**
   * Cached waveform peaks for a Sound, or `null` when there are none yet (not on
   * disk, undecodable, or still computing). The renderer draws a sharp <canvas>
   * from these and otherwise falls back to the Freesound waveform image.
   */
  getPeaks(soundId: number): Promise<PeaksPayload | null>
  /**
   * Ensure peaks get computed for a Sound (off-thread, once ever). Returns as
   * soon as the work is scheduled; listen on `onPeaks` for the outcome.
   */
  requestPeaks(soundId: number): Promise<void>
  /**
   * Subscribe to per-sound peaks status pushes (`ready` / `unavailable`).
   * Returns an unsubscribe function.
   */
  onPeaks(listener: (change: PeaksStatusChange) => void): () => void
}

const api: CoreApi = {
  search: (query, opts) => ipcRenderer.invoke('core:search', query, opts),
  searchDebounced: (query, opts) =>
    ipcRenderer.invoke('core:invoke', 'searchDebounced', [query, opts]),
  getSearchPrefs: () => ipcRenderer.invoke('core:invoke', 'getSearchPrefs', []),
  setSearchPrefs: (prefs) =>
    ipcRenderer.invoke('core:invoke', 'setSearchPrefs', [prefs]),

  signIn: () => ipcRenderer.invoke('core:invoke', 'signIn', []),
  signOut: () => ipcRenderer.invoke('core:invoke', 'signOut', []),
  getAuthState: () => ipcRenderer.invoke('core:invoke', 'getAuthState', []),
  onAuthState: (listener) => {
    const handler = (_e: unknown, state: AuthState): void => listener(state)
    ipcRenderer.on(AUTH_STATE_CHANNEL, handler)
    return () => ipcRenderer.removeListener(AUTH_STATE_CHANNEL, handler)
  },

  stageOnAudition: (soundId) =>
    ipcRenderer.invoke('core:invoke', 'stageOnAudition', [soundId]),
  cancelStaging: (soundId) =>
    ipcRenderer.invoke('core:invoke', 'cancelStaging', [soundId]),
  getStagingStatus: (ids) =>
    ipcRenderer.invoke('core:invoke', 'getStagingStatus', [ids]),
  getStagingConsent: () =>
    ipcRenderer.invoke('core:invoke', 'getStagingConsent', []),
  grantStagingConsent: () =>
    ipcRenderer.invoke('core:invoke', 'grantStagingConsent', []),
  onStagingStatus: (listener) => {
    const handler = (_e: unknown, change: StagingStatusChange): void =>
      listener(change)
    ipcRenderer.on(STAGING_STATUS_CHANNEL, handler)
    return () => ipcRenderer.removeListener(STAGING_STATUS_CHANNEL, handler)
  },

  startDrag: (soundIds, opts) =>
    ipcRenderer.invoke('core:invoke', 'startDrag', [soundIds, opts]),
  getDragCapabilities: () =>
    ipcRenderer.invoke('core:invoke', 'getDragCapabilities', []),
  endDrag: (soundIds) =>
    ipcRenderer.invoke('core:invoke', 'endDrag', [soundIds]),

  getDiskUsage: () => ipcRenderer.invoke('core:invoke', 'getDiskUsage', []),
  clearStaged: () => ipcRenderer.invoke('core:invoke', 'clearStaged', []),

  saveToLibrary: (soundId, sound) =>
    ipcRenderer.invoke('core:invoke', 'saveToLibrary', [soundId, sound]),
  getLibraryMembership: (ids) =>
    ipcRenderer.invoke('core:invoke', 'getLibraryMembership', [ids]),
  listLibrary: (opts) =>
    ipcRenderer.invoke('core:invoke', 'listLibrary', [opts]),
  deleteFromLibrary: (soundId) =>
    ipcRenderer.invoke('core:invoke', 'deleteFromLibrary', [soundId]),
  // Named channels: these two need Electron `shell`, which cannot live in core.
  revealInFinder: (soundId) =>
    ipcRenderer.invoke('core:revealInFinder', soundId),
  openFreesoundPage: (soundId) =>
    ipcRenderer.invoke('core:openExternal', soundId),

  getPeaks: (soundId) =>
    ipcRenderer.invoke('core:invoke', 'getPeaks', [soundId]),
  requestPeaks: (soundId) =>
    ipcRenderer.invoke('core:invoke', 'requestPeaks', [soundId]),
  onPeaks: (listener) => {
    const handler = (_e: unknown, change: PeaksStatusChange): void =>
      listener(change)
    ipcRenderer.on(PEAKS_STATUS_CHANNEL, handler)
    return () => ipcRenderer.removeListener(PEAKS_STATUS_CHANNEL, handler)
  },
}

contextBridge.exposeInMainWorld('core', api)
