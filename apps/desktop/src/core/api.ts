import type { FreesoundGateway } from './gateway/index'
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
} from './types'
import type { LogLevel, LogSink } from './logging/logger'
import type { UiState } from './uiState'
import type { StartupAssessment } from './startup/assessStartup'
import type {
  RebuildProgress,
  RebuildReport,
  RebuildRunner,
} from './rebuild/rebuildService'
import type { SortDir } from './db/library'
import type { AudioRenderRunner, EditEvent } from './edits/editService'
import type { Manifest } from './manifest/buildManifest'
import type { PeakRunner, PeaksPayload, PeaksStatusChange } from './peaks/peakService'
import type { AuthPlatform, AuthState, Scheduler } from './auth/index'
import type {
  StagingConsent,
  StagingStatus,
  StagingStatusChange,
} from './staging/stagingController'
import type { DragStartResult, StartDragOptions } from './staging/dragController'
import type { DragHost } from './staging/dragHost'
import type { DiskUsage, EvictionOutcome } from './staging/eviction'

export interface CoreDeps {
  /** The sole network boundary. */
  gateway: FreesoundGateway
  /** App data directory (Electron `userData` in production; a temp dir in tests). */
  dataDir: string
  /** Path to the SQLite database file. Opened here — never on the renderer thread. */
  dbPath: string
  /** Debounce window for `searchDebounced`, ms. */
  debounceMs?: number
  /** Where the app's own log is written. Omitted → `NULL_LOG_SINK`, nothing is written. */
  logSink?: LogSink

  /**
   * System browser, loopback listener and `safeStorage`. Omitted → the auth
   * commands throw and `getAuthState()` reports `signedOut`.
   */
  authPlatform?: AuthPlatform
  /** Timer seam for proactive refresh + sign-in timeout. Defaults to real timers. */
  scheduler?: Scheduler
  /** `FREESOUND_CLIENT_ID` (public). Required for sign-in. */
  clientId?: string
  onAuthStateChange?: (state: AuthState) => void

  onStagingStatusChange?: (change: StagingStatusChange) => void
  /** Cap on concurrent Original downloads. Defaults to `DOWNLOAD_CONCURRENCY`. */
  stagingConcurrency?: number
  /** Retry attempts after a transient download failure. */
  stagingMaxRetries?: number
  /** Backoff before each retry, ms. */
  stagingBackoffMs?: readonly number[]
  /**
   * Cap on total bytes of Staged Originals on disk. Exceeding it evicts
   * least-recently-accessed Staged Sounds; Library Sounds are never evicted.
   */
  stagingByteBudget?: number

  /**
   * The OS drag-and-drop boundary. Omitted → `startDrag` throws and
   * `getDragCapabilities()` reports no drag support.
   */
  dragHost?: DragHost
  /** Bundled fallback drag icon, used when the renderer supplies no waveform image. */
  dragIconFallbackPath?: string

  /** Built `peakWorker.js`; when set, peak computation runs on a worker thread. */
  peakWorkerPath?: string
  /** Test seam: replace the peak runner entirely. Wins over `peakWorkerPath`. */
  computePeaksRunner?: PeakRunner
  onPeaksStatusChange?: (change: PeaksStatusChange) => void

  /** Built `rebuildWorker.js`; when set, the sidecar scan runs on a worker thread. */
  rebuildWorkerPath?: string
  /** Test seam: replace the sidecar-scan runner. Wins over `rebuildWorkerPath`. */
  rebuildRunner?: RebuildRunner
  onRebuildProgress?: (progress: RebuildProgress) => void

  /** Renders one Edit. Omitted → `createEdit` is a silent no-op. */
  audioRenderRunner?: AudioRenderRunner
  onEditProgress?: (event: EditEvent) => void
}

/** The command API. This interface *is* the IPC contract; the bridge forwards it verbatim. */
export interface Core {
  /**
   * Full-text search through the SQLite cache. A hit costs zero gateway calls; a
   * miss costs one, persists every Sound, and prefetches the next page. Failure
   * throws `ThrottledError` / `GatewayError` / `NetworkError` — never an empty list.
   */
  search(query: string, opts?: SearchOptions): Promise<SearchResult>

  /** Debounced `search`: rapid calls collapse into one request for the trailing query. */
  searchDebounced(query: string, opts?: SearchOptions): Promise<SearchResult>

  /** The persisted sort + filter. Neutral prefs when nothing is saved or the blob is bad. */
  getSearchPrefs(): SearchPrefs

  /** Persist the sort + filter. Runs no search — the renderer re-queries itself. */
  setSearchPrefs(prefs: SearchPrefs): SearchPrefs

  /**
   * The persisted shell state — window bounds plus the last view, search text,
   * open Collection and selected Sound. `EMPTY_UI_STATE` when nothing is saved.
   */
  getUiState(): UiState

  /** Persist a patch of shell state. `undefined` keys keep their stored value. */
  setUiState(patch: Partial<UiState>): UiState

  /** The app's log file path, or `null` when logging is not wired. */
  getLogPath(): string | null

  /** The most recent `maxLines` (default 500) lines of the log, oldest first. */
  readLog(opts?: { maxLines?: number }): string[]

  /** Append one line to the app log. */
  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void

  /**
   * Sign in through the system browser. Rejects (leaving state `signedOut`) on
   * port-in-use, `state` mismatch, a cancelled/timed-out browser step, or a dead grant.
   */
  signIn(): Promise<AuthState>

  /** Sign out: clear the stored tokens only. The Library is left untouched. */
  signOut(): Promise<void>

  getAuthState(): AuthState

  /** Subscribe to auth-state transitions. Returns an unsubscribe function. */
  subscribeAuthState(listener: (state: AuthState) => void): () => void

  /**
   * Enqueue a background download of the Original on audition, cancelling the
   * previous audition's download first. A silent no-op while signed out, before
   * consent, or for an unknown Sound.
   */
  stageOnAudition(soundId: number): void

  /**
   * User-initiated download that also saves the Sound to the Library once the
   * bytes land. Needs no consent and never cancels on skip; counts against the
   * rolling 24 h quota.
   */
  downloadToLibrary(soundId: number, sound?: Sound): void

  /** Originals downloaded from Freesound in the last rolling 24 h (their cap is 2,000). */
  getDownloadsInLast24h(): number

  /** Cancel a sound's queued/in-flight staged download. */
  cancelStaging(soundId: number): void

  /** Per-sound staging status: `not-started | queued | downloading | ready | failed`. */
  getStagingStatus(ids: number[]): Record<number, StagingStatus>

  /** Whether the first-run "auditioning downloads sounds" notice was acknowledged. */
  getStagingConsent(): StagingConsent

  /** Record that the user acknowledged the first-run notice. Idempotent. */
  grantStagingConsent(): StagingConsent

  /** Subscribe to per-sound staging status transitions. Returns an unsubscribe function. */
  subscribeStagingStatus(
    listener: (change: StagingStatusChange) => void,
  ): () => void

  /**
   * Begin an OS drag-out. Hardlinks each Original under a human-readable name;
   * the content-store path is never dragged and a Preview is never substituted.
   * Throws `OriginalNotStagedError` if a Sound's Original is not staged.
   */
  startDrag(
    soundIds: number | readonly number[],
    opts?: StartDragOptions,
  ): DragStartResult

  /** `multiSound` is true only where multi-file drag is verified to deliver every file. */
  getDragCapabilities(): { multiSound: boolean }

  /**
   * Signal that an OS drag-out has finished (from `dragend`, whatever the
   * outcome). Releases the eviction hold. Safe to call with unknown ids.
   */
  endDrag(soundIds: number | readonly number[]): void

  /** On-disk footprint in bytes, split by intent: `staged`, `library`, `total`. */
  getDiskUsage(): Promise<DiskUsage>

  /**
   * Delete every Staged Original, sidecar and row to reclaim space now. The
   * Library is untouched; a Sound with a live Drag-Out is skipped.
   */
  clearStaged(): Promise<EvictionOutcome>

  /**
   * Save a Sound to the Library. A pure DB write — the Original is never moved
   * or copied. Idempotent (keeps the original `saved_at`). A `sounds` row must
   * exist: pass the `Sound` or this throws. `collectionIds` files it into those
   * Collections in the same transaction; each must exist or this throws first.
   */
  saveToLibrary(
    soundId: number,
    sound?: Sound,
    collectionIds?: readonly number[],
  ): void

  /** Batch "is this in the Library?" for search-result badging. */
  getLibraryMembership(ids: number[]): Record<number, boolean>

  /**
   * The Library as `LibrarySound[]`, ordered by date saved (`desc` by default).
   * Makes no gateway call — works offline and while signed out.
   */
  listLibrary(opts?: { sort?: 'savedAt'; dir?: SortDir }): LibrarySound[]

  /**
   * The Library narrowed by a structured filter, composing with AND. Served
   * entirely from the database. An empty filter is identical to `listLibrary`.
   */
  filterLibrary(
    filter: LibraryFilter,
    opts?: { sort?: 'savedAt'; dir?: SortDir },
  ): LibrarySound[]

  /**
   * Give a Library Sound the user's own name (`null` / `''` clears it). Writes
   * only the overlay — author, License and Freesound linkage stay intact. For an
   * Edit the name is also mirrored into its sidecar (best-effort). Throws if the
   * Sound is not in the Library.
   */
  setCustomName(soundId: number, customName: string | null): void

  /**
   * Replace a Library Sound's own tags, kept separate from the Freesound ones.
   * Trimmed, de-duped case-insensitively, empties dropped. Throws if the Sound
   * is not in the Library.
   */
  setLibraryTags(soundId: number, tags: string[]): void

  /** The persisted Library filter; `{}` when nothing is saved or the blob is bad. */
  getLibraryFilter(): LibraryFilter

  /** Persist the Library filter. Runs no query. */
  setLibraryFilter(filter: LibraryFilter): LibraryFilter

  /**
   * Remove a Sound from the Library and unlink its Original + sidecar. The
   * `sounds` metadata row is kept. Makes no gateway call.
   */
  deleteFromLibrary(soundId: number): Promise<void>

  /** Absolute path to a Sound's Original, or `null` if it is not on disk. */
  getContentPath(soundId: number): string | null

  /** A Sound's page on freesound.org, or `null` if the core has no metadata for it. */
  getFreesoundUrl(soundId: number): string | null

  /** Create a named Collection. The name is trimmed; empty throws. Names need not be unique. */
  createCollection(name: string): CollectionSummary

  /** Rename a Collection. The name is trimmed; empty throws. No-op if the id is unknown. */
  renameCollection(collectionId: number, name: string): void

  /**
   * Delete a Collection. Members stay in the Library and in any other
   * Collection. No-op if the id is unknown.
   */
  deleteCollection(collectionId: number): void

  /**
   * Add Sounds to a Collection in one transaction. Idempotent. Throws if the
   * Collection does not exist or any Sound is not in the Library.
   */
  addToCollection(collectionId: number, soundIds: readonly number[]): void

  /** Remove a Sound from a Collection. It stays in the Library and other Collections. */
  removeFromCollection(collectionId: number, soundId: number): void

  /** Every Collection with its member count, ordered by name. */
  listCollections(): CollectionSummary[]

  /**
   * A Collection's Sounds as `LibrarySound[]`, most-recently-added first.
   * Makes no gateway call.
   */
  listCollectionSounds(
    collectionId: number,
    opts?: { dir?: SortDir },
  ): LibrarySound[]

  /** For each requested Sound id, the Collections it belongs to (`[]` when none). */
  getCollectionsForSounds(soundIds: number[]): Record<number, CollectionRef[]>

  /**
   * Generate an Attribution Manifest for a Collection — a snapshot rendered from
   * the membership at the moment of the call. `manifest.text` is the document to
   * copy verbatim. An empty Collection yields a clear message, not a blank
   * document. Throws if the Collection does not exist.
   */
  generateManifest(collectionId: number): Manifest

  /**
   * Cached waveform peaks, or `null` when there are none (not on disk,
   * undecodable, or still computing). Reads the cache only — never computes.
   */
  getPeaks(soundId: number): PeaksPayload | null

  /**
   * Ensure peaks exist. Returns immediately; computation runs off-thread and the
   * outcome is announced. Deduped per Sound and computed at most once ever.
   */
  requestPeaks(soundId: number): void

  /** Subscribe to peaks status transitions (`ready` / `unavailable`). */
  subscribePeaksStatus(
    listener: (change: PeaksStatusChange) => void,
  ): () => void

  /**
   * The startup health verdict captured before the database was opened: whether
   * the DB file was usable, how many sidecars exist, and whether to offer a rebuild.
   */
  getStartupAssessment(): StartupAssessment

  /**
   * Reconstruct `sounds` rows and Library membership from `<id>.json` sidecars
   * alone. The scan runs off-thread and reports progress via
   * `subscribeRebuildProgress`. Returns what was `recovered`, `orphanAudio`
   * (reported, never deleted), `orphanSidecars` (removed), `malformed`, and
   * `notRecoverable`. Safe to re-run.
   */
  rebuildFromSidecars(): Promise<RebuildReport>

  /** Subscribe to sidecar-scan progress during a `rebuildFromSidecars` run. */
  subscribeRebuildProgress(listener: (p: RebuildProgress) => void): () => void

  /**
   * Render `parentSoundId`'s Original into a new Edit — a derived local Sound
   * with a negative id, born straight into the Library. Resolves `null` (a
   * silent no-op) when the parent is unknown, its Original is off disk, or the
   * render was cancelled. Rejects on a genuine render failure.
   */
  createEdit(
    parentSoundId: number,
    spec: EditSpec,
  ): Promise<{ editId: number } | null>

  /** Abort an in-flight `createEdit` for this parent. No-op if none is running. */
  cancelEdit(parentSoundId: number): void

  /** Subscribe to Edit render progress and terminal failure. */
  subscribeEditProgress(listener: (event: EditEvent) => void): () => void

  /** Release the database handle and cancel any pending timers. */
  close(): void
}
