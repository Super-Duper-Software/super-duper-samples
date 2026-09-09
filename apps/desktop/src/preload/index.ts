import { contextBridge, ipcRenderer } from 'electron'
import type { CoreApi } from './coreApi'
import { CHANNELS, type EventChannel } from '../shared/channels'

export type { CoreApi, RebuildOffer } from './coreApi'

export type {
  CollectionRef,
  CollectionSummary,
  EditSpec,
  LibraryFilter,
  LibrarySound,
  LicenseFilter,
  SearchFilter,
  SearchOptions,
  SearchPrefs,
  SearchResult,
  SearchSort,
} from '../core/types'

export type {
  AuthState,
  ClassifiedError,
  DiskUsage,
  EditEvent,
  ErrorKind,
  EvictionOutcome,
  LogLevel,
  Manifest,
  ManifestEntry,
  ManifestSummary,
  PeaksPayload,
  PeaksStatusChange,
  RebuildProgress,
  RebuildReport,
  ShellView,
  StagingConsent,
  StagingStatus,
  StagingStatusChange,
  UiState,
  WindowBounds,
} from '../core'

/** Forward a `Core` command over the generic command channel. */
function cmd<A extends unknown[], R>(name: string) {
  return (...args: A): Promise<R> =>
    ipcRenderer.invoke('core:invoke', name, args) as Promise<R>
}

/** Subscribe to a main-process push channel; returns the unsubscribe function. */
function on<T>(channel: EventChannel) {
  return (listener: (payload: T) => void): (() => void) => {
    const handler = (_e: unknown, payload: T): void => listener(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

const api: CoreApi = {
  search: (query, opts) => ipcRenderer.invoke('core:search', query, opts),
  searchDebounced: cmd('searchDebounced'),
  getSearchPrefs: cmd('getSearchPrefs'),
  setSearchPrefs: cmd('setSearchPrefs'),

  getUiState: cmd('getUiState'),
  setUiState: cmd('setUiState'),
  getLaunchCount: cmd('getLaunchCount'),
  getLogPath: cmd('getLogPath'),
  readLog: cmd('readLog'),
  log: cmd('log'),
  showLogs: () => ipcRenderer.invoke('core:showLogs'),
  openSupportPage: () => ipcRenderer.invoke('core:openSupportPage'),
  openSupportEmail: (opts) => ipcRenderer.invoke('core:openSupportEmail', opts),

  signIn: cmd('signIn'),
  signOut: cmd('signOut'),
  getAuthState: cmd('getAuthState'),
  onAuthState: on(CHANNELS.authState),

  stageOnAudition: cmd('stageOnAudition'),
  downloadToLibrary: cmd('downloadToLibrary'),
  getDownloadsInLast24h: cmd('getDownloadsInLast24h'),
  cancelStaging: cmd('cancelStaging'),
  getStagingStatus: cmd('getStagingStatus'),
  getStagingConsent: cmd('getStagingConsent'),
  grantStagingConsent: cmd('grantStagingConsent'),
  onStagingStatus: on(CHANNELS.stagingStatus),

  startDrag: cmd('startDrag'),
  getDragCapabilities: cmd('getDragCapabilities'),
  endDrag: cmd('endDrag'),

  getDiskUsage: cmd('getDiskUsage'),
  clearStaged: cmd('clearStaged'),

  saveToLibrary: cmd('saveToLibrary'),
  getLibraryMembership: cmd('getLibraryMembership'),
  listLibrary: cmd('listLibrary'),
  filterLibrary: cmd('filterLibrary'),
  setCustomName: cmd('setCustomName'),
  setLibraryTags: cmd('setLibraryTags'),
  getLibraryFilter: cmd('getLibraryFilter'),
  setLibraryFilter: cmd('setLibraryFilter'),
  deleteFromLibrary: cmd('deleteFromLibrary'),
  revealInFinder: (soundId) =>
    ipcRenderer.invoke('core:revealInFinder', soundId),
  openFreesoundPage: (soundId) =>
    ipcRenderer.invoke('core:openExternal', soundId),

  createCollection: cmd('createCollection'),
  renameCollection: cmd('renameCollection'),
  deleteCollection: cmd('deleteCollection'),
  addToCollection: cmd('addToCollection'),
  removeFromCollection: cmd('removeFromCollection'),
  listCollections: cmd('listCollections'),
  listCollectionSounds: cmd('listCollectionSounds'),
  getCollectionsForSounds: cmd('getCollectionsForSounds'),

  generateManifest: cmd('generateManifest'),
  saveManifest: (defaultFileName, text) =>
    ipcRenderer.invoke('core:saveManifest', defaultFileName, text),

  getPeaks: cmd('getPeaks'),
  requestPeaks: cmd('requestPeaks'),
  onPeaks: on(CHANNELS.peaksStatus),
  getContentPath: cmd('getContentPath'),

  rebuildFromSidecars: cmd('rebuildFromSidecars'),
  onRebuildOffer: on(CHANNELS.rebuildOffer),
  onRebuildProgress: on(CHANNELS.rebuildProgress),

  createEdit: cmd('createEdit'),
  cancelEdit: cmd('cancelEdit'),
  onEditProgress: on(CHANNELS.editProgress),
}

contextBridge.exposeInMainWorld('core', api)
