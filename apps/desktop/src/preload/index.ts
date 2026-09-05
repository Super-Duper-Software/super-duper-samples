import { contextBridge, ipcRenderer } from 'electron'
import type {
  AuthState,
  DiskUsage,
  EditEvent,
  EvictionOutcome,
  Manifest,
  PeaksPayload,
  PeaksStatusChange,
  RebuildProgress,
  RebuildReport,
  StagingConsent,
  StagingStatus,
  StagingStatusChange,
} from '../core'
import type {
  CollectionRef,
  CollectionSummary,
  EditSpec,
  LibraryFilter,
  LibrarySound,
  SearchOptions,
  SearchPrefs,
  SearchResult,
  Sound,
} from '../core/types'
import type { LogLevel, SortDir, UiState } from '../core'

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

/**
 * Payload the main process pushes on `core:event:rebuildOffer` (ticket 14) when
 * the database was missing / corrupt / half-migrated but sidecars are on disk.
 */
export interface RebuildOffer {
  /** Why the database was unusable, or `null` if it opened but lacked the schema. */
  reason: 'missing' | 'unreadable' | 'schema-incomplete' | null
  /** How many `<id>.json` sidecars are available to rebuild from. */
  sidecarCount: number
  /** The plain-language "not recoverable" warning to show before accepting. */
  notRecoverable: string
}

/** Channel the main process pushes auth-state transitions on (ticket 07). */
const AUTH_STATE_CHANNEL = 'core:event:authState'
/** Channel the main process pushes per-sound staging status changes on (ticket 08). */
const STAGING_STATUS_CHANNEL = 'core:event:stagingStatus'
/** Channel the main process pushes per-sound computed-peaks status changes on (ticket 12). */
const PEAKS_STATUS_CHANNEL = 'core:event:peaksStatus'
/** Channel the main process pushes a "database gone — rebuild?" offer on (ticket 14). */
const REBUILD_OFFER_CHANNEL = 'core:event:rebuildOffer'
/** Channel the main process pushes sidecar-scan progress on during a rebuild (ticket 14). */
const REBUILD_PROGRESS_CHANNEL = 'core:event:rebuildProgress'
/** Channel the main process pushes Edit render progress / terminal failure on (ticket 08). */
const EDIT_PROGRESS_CHANNEL = 'core:event:editProgress'

export interface CoreApi {
  search(query: string, opts?: SearchOptions): Promise<SearchResult>
  /** Debounced search — rapid keystrokes collapse to one gateway call (ticket 05). */
  searchDebounced(query: string, opts?: SearchOptions): Promise<SearchResult>

  /** The persisted active sort + filter state, restored on startup. */
  getSearchPrefs(): Promise<SearchPrefs>
  /** Persist the active sort + filter state. Does not run a search. */
  setSearchPrefs(prefs: SearchPrefs): Promise<SearchPrefs>

  /** The persisted shell state — window bounds + last view / search / selection. */
  getUiState(): Promise<UiState>
  /** Persist a patch of shell state. Merges onto what is stored; runs no query. */
  setUiState(patch: Partial<UiState>): Promise<UiState>
  /** Path to the app's own log file, or `null` when logging is not wired. */
  getLogPath(): Promise<string | null>
  /** The most recent lines of the app log, oldest first (default 500). */
  readLog(opts?: { maxLines?: number }): Promise<string[]>
  /** Append a line to the app log — the renderer calls this for every surfaced error. */
  log(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ): Promise<void>
  /** Reveal the log file in Finder / Explorer (main-process `shell`). */
  showLogs(): Promise<void>
  /** Open the Ko-fi support page in the user's default browser. */
  openSupportPage(): Promise<void>
  /**
   * Open the user's mail client with a new message to the support address.
   * `subject` / `body` prefill the draft (the address is fixed in the main
   * process).
   */
  openSupportEmail(opts?: { subject?: string; body?: string }): Promise<void>

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

  /** Enqueue a background download of a Sound's Original (called on audition). Fire-and-forget. */
  stageOnAudition(soundId: number): Promise<void>
  /**
   * Explicitly download a Sound's Original AND save it to the Library once the
   * bytes land. Fire-and-forget; progress arrives via `onStagingStatus`. Backs
   * the search row's "Download" button and the `s` shortcut.
   */
  downloadToLibrary(soundId: number, sound?: Sound): Promise<void>
  /** Originals downloaded from Freesound in the last rolling 24 h (quota cap: 2,000). */
  getDownloadsInLast24h(): Promise<number>
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

  /** On-disk footprint in bytes, split into `staged` / `library` / `total`. */
  getDiskUsage(): Promise<DiskUsage>
  /**
   * Delete every Staged Original + sidecar + row to reclaim space now. The
   * Library is untouched; Sounds with a live Drag-Out are skipped.
   */
  clearStaged(): Promise<EvictionOutcome>

  /**
   * Save a Sound to the Library (a single-keystroke action in the renderer).
   * Instant: writes one DB row, never moves or copies the file. Idempotent.
   * Pass the `Sound` so the core can persist its metadata if needed.
   */
  saveToLibrary(
    soundId: number,
    sound?: Sound,
    collectionIds?: number[],
  ): Promise<void>
  /** Batch "already in the Library?" for search-result badges. */
  getLibraryMembership(ids: number[]): Promise<Record<number, boolean>>
  /**
   * The Library as `LibrarySound[]` (Sound + the user's custom name / tags),
   * newest-saved first by default. No gateway call.
   */
  listLibrary(opts?: {
    sort?: 'savedAt'
    dir?: SortDir
  }): Promise<LibrarySound[]>
  /**
   * The Library narrowed by a structured filter (tag / License / duration / file
   * format / free text, composing with AND). Database-only — never a network
   * request. An empty filter is identical to `listLibrary`.
   */
  filterLibrary(
    filter: LibraryFilter,
    opts?: { sort?: 'savedAt'; dir?: SortDir },
  ): Promise<LibrarySound[]>
  /**
   * Give a Library Sound the user's own name (or clear it with `null` / `''`).
   * Keeps the Sound's author, License and Freesound linkage intact.
   */
  setCustomName(soundId: number, customName: string | null): Promise<void>
  /** Replace a Library Sound's own tag list (distinct from the inherited tags). */
  setLibraryTags(soundId: number, tags: string[]): Promise<void>
  /** The persisted active Library filter, restored on startup. */
  getLibraryFilter(): Promise<LibraryFilter>
  /** Persist the active Library filter. Does not run a query. */
  setLibraryFilter(filter: LibraryFilter): Promise<LibraryFilter>
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

  /** Create a named Collection. Returns it with `count: 0`. Empty name rejects. */
  createCollection(name: string): Promise<CollectionSummary>
  /** Rename a Collection. Empty name rejects. */
  renameCollection(collectionId: number, name: string): Promise<void>
  /**
   * Delete a Collection (the renderer confirms first). Its Sounds stay in the
   * Library and in any other Collection.
   */
  deleteCollection(collectionId: number): Promise<void>
  /**
   * Add one or more Sounds to a Collection in one action. Idempotent; rejects if
   * a Sound is not in the Library or the Collection does not exist.
   */
  addToCollection(collectionId: number, soundIds: number[]): Promise<void>
  /** Remove a Sound from a Collection — it stays in the Library and other Collections. */
  removeFromCollection(collectionId: number, soundId: number): Promise<void>
  /** Every Collection with its member count, ordered by name. No gateway call. */
  listCollections(): Promise<CollectionSummary[]>
  /**
   * A Collection's Sounds as `LibrarySound[]`, most-recently-added first.
   * Database-only — browses / plays / drags exactly like the Library.
   */
  listCollectionSounds(
    collectionId: number,
    opts?: { dir?: SortDir },
  ): Promise<LibrarySound[]>
  /** For each Sound id, the Collections it belongs to (`{ id, name }`) — the row badges. */
  getCollectionsForSounds(
    soundIds: number[],
  ): Promise<Record<number, CollectionRef[]>>

  /**
   * Generate an Attribution Manifest for a Collection — a snapshot credits
   * document (title, author, License, Freesound URL per Sound; attribution-
   * required separated from CC0; non-commercial Sounds flagged and listed
   * apart). `manifest.text` is the plain-text document to copy or save. An
   * empty Collection yields a clear message, not a blank document. Rejects if
   * the Collection does not exist.
   */
  generateManifest(collectionId: number): Promise<Manifest>
  /**
   * Write manifest text to a file the user chooses (a native Save dialog).
   * Resolves `{ saved: false }` if the user cancels, `{ saved: true, path }`
   * once written. Main-process only — it needs Electron `dialog` + `fs`.
   */
  saveManifest(
    defaultFileName: string,
    text: string,
  ): Promise<{ saved: boolean; path?: string }>

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
  /**
   * Absolute path to a Sound's Original on disk, or `null` if it is not there
   * (a search result never staged, or a Library Sound whose file went missing).
   * Ticket 07 turns this into a `file://` URL for the Edit view's local audition.
   */
  getContentPath(soundId: number): Promise<string | null>

  /**
   * Reconstruct the Library from the content store's `<id>.json` sidecars when
   * the database was lost. Resolves with a report of what was recovered (each
   * with author + License), what had no sidecar (orphan audio — left on disk),
   * what had no audio (orphan sidecars — removed), what was malformed, and the
   * plain statement that custom names, custom tags and Collections are gone.
   * The scan runs off the main thread; listen on `onRebuildProgress` for a bar.
   */
  rebuildFromSidecars(): Promise<RebuildReport>
  /**
   * Subscribe to the "your database was missing or unreadable — rebuild from
   * sidecars?" offer the main process pushes once on startup. Returns an
   * unsubscribe function.
   */
  onRebuildOffer(listener: (offer: RebuildOffer) => void): () => void
  /**
   * Subscribe to sidecar-scan progress (`{ done, total }`) during a rebuild.
   * Returns an unsubscribe function.
   */
  onRebuildProgress(listener: (progress: RebuildProgress) => void): () => void

  /**
   * Render `parentSoundId`'s Original (or a marked region of it) into a new
   * Edit per `spec`. Resolves `{ editId }` once it is a complete Library
   * item; resolves `null` on a silent no-op (parent gone, Original not on
   * disk, or the render was cancelled via `cancelEdit`). Rejects on a genuine
   * render failure — surface `error.message` in the dialog.
   */
  createEdit(
    parentSoundId: number,
    spec: EditSpec,
  ): Promise<{ editId: number } | null>
  /** Abort an in-flight `createEdit` render for this parent. No-op if none is running. */
  cancelEdit(parentSoundId: number): Promise<void>
  /**
   * Subscribe to Edit render progress / terminal failure pushes. Returns an
   * unsubscribe function.
   */
  onEditProgress(listener: (event: EditEvent) => void): () => void
}

const api: CoreApi = {
  search: (query, opts) => ipcRenderer.invoke('core:search', query, opts),
  searchDebounced: (query, opts) =>
    ipcRenderer.invoke('core:invoke', 'searchDebounced', [query, opts]),
  getSearchPrefs: () => ipcRenderer.invoke('core:invoke', 'getSearchPrefs', []),
  setSearchPrefs: (prefs) =>
    ipcRenderer.invoke('core:invoke', 'setSearchPrefs', [prefs]),

  getUiState: () => ipcRenderer.invoke('core:invoke', 'getUiState', []),
  setUiState: (patch) =>
    ipcRenderer.invoke('core:invoke', 'setUiState', [patch]),
  getLogPath: () => ipcRenderer.invoke('core:invoke', 'getLogPath', []),
  readLog: (opts) => ipcRenderer.invoke('core:invoke', 'readLog', [opts]),
  log: (level, message, meta) =>
    ipcRenderer.invoke('core:invoke', 'log', [level, message, meta]),
  showLogs: () => ipcRenderer.invoke('core:showLogs'),
  openSupportPage: () => ipcRenderer.invoke('core:openSupportPage'),
  openSupportEmail: (opts) =>
    ipcRenderer.invoke('core:openSupportEmail', opts),

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
  downloadToLibrary: (soundId, sound) =>
    ipcRenderer.invoke('core:invoke', 'downloadToLibrary', [soundId, sound]),
  getDownloadsInLast24h: () =>
    ipcRenderer.invoke('core:invoke', 'getDownloadsInLast24h', []),
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

  saveToLibrary: (soundId, sound, collectionIds) =>
    ipcRenderer.invoke('core:invoke', 'saveToLibrary', [
      soundId,
      sound,
      collectionIds,
    ]),
  getLibraryMembership: (ids) =>
    ipcRenderer.invoke('core:invoke', 'getLibraryMembership', [ids]),
  listLibrary: (opts) =>
    ipcRenderer.invoke('core:invoke', 'listLibrary', [opts]),
  filterLibrary: (filter, opts) =>
    ipcRenderer.invoke('core:invoke', 'filterLibrary', [filter, opts]),
  setCustomName: (soundId, customName) =>
    ipcRenderer.invoke('core:invoke', 'setCustomName', [soundId, customName]),
  setLibraryTags: (soundId, tags) =>
    ipcRenderer.invoke('core:invoke', 'setLibraryTags', [soundId, tags]),
  getLibraryFilter: () =>
    ipcRenderer.invoke('core:invoke', 'getLibraryFilter', []),
  setLibraryFilter: (filter) =>
    ipcRenderer.invoke('core:invoke', 'setLibraryFilter', [filter]),
  deleteFromLibrary: (soundId) =>
    ipcRenderer.invoke('core:invoke', 'deleteFromLibrary', [soundId]),
  revealInFinder: (soundId) =>
    ipcRenderer.invoke('core:revealInFinder', soundId),
  openFreesoundPage: (soundId) =>
    ipcRenderer.invoke('core:openExternal', soundId),

  createCollection: (name) =>
    ipcRenderer.invoke('core:invoke', 'createCollection', [name]),
  renameCollection: (collectionId, name) =>
    ipcRenderer.invoke('core:invoke', 'renameCollection', [collectionId, name]),
  deleteCollection: (collectionId) =>
    ipcRenderer.invoke('core:invoke', 'deleteCollection', [collectionId]),
  addToCollection: (collectionId, soundIds) =>
    ipcRenderer.invoke('core:invoke', 'addToCollection', [
      collectionId,
      soundIds,
    ]),
  removeFromCollection: (collectionId, soundId) =>
    ipcRenderer.invoke('core:invoke', 'removeFromCollection', [
      collectionId,
      soundId,
    ]),
  listCollections: () =>
    ipcRenderer.invoke('core:invoke', 'listCollections', []),
  listCollectionSounds: (collectionId, opts) =>
    ipcRenderer.invoke('core:invoke', 'listCollectionSounds', [
      collectionId,
      opts,
    ]),
  getCollectionsForSounds: (soundIds) =>
    ipcRenderer.invoke('core:invoke', 'getCollectionsForSounds', [soundIds]),

  generateManifest: (collectionId) =>
    ipcRenderer.invoke('core:invoke', 'generateManifest', [collectionId]),
  saveManifest: (defaultFileName, text) =>
    ipcRenderer.invoke('core:saveManifest', defaultFileName, text),

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
  getContentPath: (soundId) =>
    ipcRenderer.invoke('core:invoke', 'getContentPath', [soundId]),

  rebuildFromSidecars: () =>
    ipcRenderer.invoke('core:invoke', 'rebuildFromSidecars', []),
  onRebuildOffer: (listener) => {
    const handler = (_e: unknown, offer: RebuildOffer): void => listener(offer)
    ipcRenderer.on(REBUILD_OFFER_CHANNEL, handler)
    return () => ipcRenderer.removeListener(REBUILD_OFFER_CHANNEL, handler)
  },
  onRebuildProgress: (listener) => {
    const handler = (_e: unknown, progress: RebuildProgress): void =>
      listener(progress)
    ipcRenderer.on(REBUILD_PROGRESS_CHANNEL, handler)
    return () => ipcRenderer.removeListener(REBUILD_PROGRESS_CHANNEL, handler)
  },

  createEdit: (parentSoundId, spec) =>
    ipcRenderer.invoke('core:invoke', 'createEdit', [parentSoundId, spec]),
  cancelEdit: (parentSoundId) =>
    ipcRenderer.invoke('core:invoke', 'cancelEdit', [parentSoundId]),
  onEditProgress: (listener) => {
    const handler = (_e: unknown, event: EditEvent): void => listener(event)
    ipcRenderer.on(EDIT_PROGRESS_CHANNEL, handler)
    return () => ipcRenderer.removeListener(EDIT_PROGRESS_CHANNEL, handler)
  },
}

contextBridge.exposeInMainWorld('core', api)
