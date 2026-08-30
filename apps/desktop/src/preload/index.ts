// The contextBridge surface. This IS the IPC contract: it forwards the core's
// command API verbatim to the renderer and adds nothing of its own. Later tickets
// extend `CoreApi` in lockstep with the core's `Core` interface.

import { contextBridge, ipcRenderer } from 'electron'
import type { AuthState } from '../core'
import type { SearchOptions, SearchResult } from '../core/types'

export type { AuthState } from '../core'

/** Channel the main process pushes auth-state transitions on (ticket 07). */
const AUTH_STATE_CHANNEL = 'core:event:authState'

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
}

contextBridge.exposeInMainWorld('core', api)
