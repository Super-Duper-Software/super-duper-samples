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

/**
 * Payload the main process pushes on `core:event:rebuildOffer` when the database
 * was missing / corrupt / half-migrated but sidecars are on disk.
 */
export interface RebuildOffer {
  /** Why the database was unusable, or `null` if it opened but lacked the schema. */
  reason: 'missing' | 'unreadable' | 'schema-incomplete' | null
  sidecarCount: number
  /** The plain-language "not recoverable" warning to show before accepting. */
  notRecoverable: string
}

/**
 * The renderer's view of the core. Every method mirrors the identically named
 * `Core` command (documented in `src/core/api.ts`) with its result promisified;
 * `on*` methods subscribe to a main-process push and return an unsubscribe
 * function. The handful of commands that have no `Core` equivalent need
 * Electron itself and are documented below.
 */
export interface CoreApi {
  search(query: string, opts?: SearchOptions): Promise<SearchResult>
  searchDebounced(query: string, opts?: SearchOptions): Promise<SearchResult>

  getSearchPrefs(): Promise<SearchPrefs>
  setSearchPrefs(prefs: SearchPrefs): Promise<SearchPrefs>

  getUiState(): Promise<UiState>
  setUiState(patch: Partial<UiState>): Promise<UiState>
  getLaunchCount(): Promise<number>
  getLogPath(): Promise<string | null>
  readLog(opts?: { maxLines?: number }): Promise<string[]>
  log(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ): Promise<void>
  /** Reveal the log file in Finder / Explorer. */
  showLogs(): Promise<void>
  /** Open the Ko-fi support page in the user's default browser. */
  openSupportPage(): Promise<void>
  /**
   * Open the user's mail client with a new message to the support address
   * (fixed in the main process); `subject` / `body` prefill the draft.
   */
  openSupportEmail(opts?: { subject?: string; body?: string }): Promise<void>

  signIn(): Promise<AuthState>
  signOut(): Promise<void>
  getAuthState(): Promise<AuthState>
  onAuthState(listener: (state: AuthState) => void): () => void

  stageOnAudition(soundId: number): Promise<void>
  downloadToLibrary(soundId: number, sound?: Sound): Promise<void>
  getDownloadsInLast24h(): Promise<number>
  cancelStaging(soundId: number): Promise<void>
  getStagingStatus(ids: number[]): Promise<Record<number, StagingStatus>>
  getStagingConsent(): Promise<StagingConsent>
  grantStagingConsent(): Promise<StagingConsent>
  onStagingStatus(listener: (change: StagingStatusChange) => void): () => void

  /**
   * Call from the row's `dragstart` handler after `event.preventDefault()`.
   * `iconDataUrl` is a PNG of the rendered waveform for the drag image. Rejects
   * when a Sound's Original is not on disk — show the message; never fall back
   * to a Preview.
   */
  startDrag(
    soundIds: number | number[],
    opts?: { iconDataUrl?: string },
  ): Promise<{
    filePath: string
    extraFilePaths: string[]
    soundIds: number[]
  }>
  getDragCapabilities(): Promise<{ multiSound: boolean }>
  endDrag(soundIds: number | number[]): Promise<void>

  getDiskUsage(): Promise<DiskUsage>
  clearStaged(): Promise<EvictionOutcome>

  saveToLibrary(
    soundId: number,
    sound?: Sound,
    collectionIds?: number[],
  ): Promise<void>
  getLibraryMembership(ids: number[]): Promise<Record<number, boolean>>
  listLibrary(opts?: {
    sort?: 'savedAt'
    dir?: SortDir
  }): Promise<LibrarySound[]>
  filterLibrary(
    filter: LibraryFilter,
    opts?: { sort?: 'savedAt'; dir?: SortDir },
  ): Promise<LibrarySound[]>
  setCustomName(soundId: number, customName: string | null): Promise<void>
  setLibraryTags(soundId: number, tags: string[]): Promise<void>
  getLibraryFilter(): Promise<LibraryFilter>
  setLibraryFilter(filter: LibraryFilter): Promise<LibraryFilter>
  deleteFromLibrary(soundId: number): Promise<void>
  /** Reveal a Sound's Original in Finder / Explorer. No-op if it is not on disk. */
  revealInFinder(soundId: number): Promise<void>
  /** Open a Sound's page on freesound.org in the system browser. */
  openFreesoundPage(soundId: number): Promise<void>

  createCollection(name: string): Promise<CollectionSummary>
  renameCollection(collectionId: number, name: string): Promise<void>
  deleteCollection(collectionId: number): Promise<void>
  addToCollection(collectionId: number, soundIds: number[]): Promise<void>
  removeFromCollection(collectionId: number, soundId: number): Promise<void>
  listCollections(): Promise<CollectionSummary[]>
  listCollectionSounds(
    collectionId: number,
    opts?: { dir?: SortDir },
  ): Promise<LibrarySound[]>
  getCollectionsForSounds(
    soundIds: number[],
  ): Promise<Record<number, CollectionRef[]>>

  generateManifest(collectionId: number): Promise<Manifest>
  /**
   * Write manifest text to a file the user chooses (a native Save dialog).
   * Resolves `{ saved: false }` if they cancel.
   */
  saveManifest(
    defaultFileName: string,
    text: string,
  ): Promise<{ saved: boolean; path?: string }>

  getPeaks(soundId: number): Promise<PeaksPayload | null>
  requestPeaks(soundId: number): Promise<void>
  onPeaks(listener: (change: PeaksStatusChange) => void): () => void
  getContentPath(soundId: number): Promise<string | null>

  rebuildFromSidecars(): Promise<RebuildReport>
  /** Subscribe to the startup "rebuild from sidecars?" offer. */
  onRebuildOffer(listener: (offer: RebuildOffer) => void): () => void
  onRebuildProgress(listener: (progress: RebuildProgress) => void): () => void

  createEdit(
    parentSoundId: number,
    spec: EditSpec,
  ): Promise<{ editId: number } | null>
  cancelEdit(parentSoundId: number): Promise<void>
  onEditProgress(listener: (event: EditEvent) => void): () => void
}
