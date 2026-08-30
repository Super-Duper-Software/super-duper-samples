// The contextBridge surface. This IS the IPC contract: it forwards the core's
// command API verbatim to the renderer and adds nothing of its own. Later tickets
// extend `CoreApi` in lockstep with the core's `Core` interface.

import { contextBridge, ipcRenderer } from 'electron'
import type { SearchOptions, SearchResult } from '../core/types'

export interface CoreApi {
  search(query: string, opts?: SearchOptions): Promise<SearchResult>
}

const api: CoreApi = {
  search: (query, opts) => ipcRenderer.invoke('core:search', query, opts),
}

contextBridge.exposeInMainWorld('core', api)
