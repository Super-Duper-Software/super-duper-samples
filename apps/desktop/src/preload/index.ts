// The contextBridge surface. This IS the IPC contract: it forwards the core's
// command API verbatim to the renderer and adds nothing of its own. Later tickets
// extend `CoreApi` in lockstep with the core's `Core` interface.

import { contextBridge, ipcRenderer } from 'electron'
import type {
  AuthState,
  StagingConsent,
  StagingStatus,
  StagingStatusChange,
} from '../core'
import type { SearchOptions, SearchResult } from '../core/types'

export type { AuthState, StagingConsent, StagingStatus, StagingStatusChange } from '../core'

/** Channel the main process pushes auth-state transitions on (ticket 07). */
const AUTH_STATE_CHANNEL = 'core:event:authState'
/** Channel the main process pushes per-sound staging status changes on (ticket 08). */
const STAGING_STATUS_CHANNEL = 'core:event:stagingStatus'

export interface CoreApi {
  search(query: string, opts?: SearchOptions): Promise<SearchResult>
  /** Debounced search — rapid keystrokes collapse to one gateway call (ticket 05). */
  searchDebounced(query: string, opts?: SearchOptions): Promise<SearchResult>

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
  ): Promise<{ filePath: string; extraFilePaths: string[]; soundIds: number[] }>
  /** Whether the UI may offer multi-Sound drag on this platform (macOS only for now). */
  getDragCapabilities(): Promise<{ multiSound: boolean }>
}

const api: CoreApi = {
  search: (query, opts) => ipcRenderer.invoke('core:search', query, opts),
  searchDebounced: (query, opts) =>
    ipcRenderer.invoke('core:invoke', 'searchDebounced', [query, opts]),

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
}

contextBridge.exposeInMainWorld('core', api)
