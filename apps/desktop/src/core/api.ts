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
import type { ClientErrorEvent, ErrorTelemetrySink } from './telemetry'
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
  /** Omitted → `NULL_LOG_SINK`, nothing is written. */
  logSink?: LogSink
  /**
   * Omitted → error events are dropped. The main process passes a sink that
   * aggregates allowlisted failures into anonymous counts and POSTs them to the
   * token Worker's `/report` endpoint (see `main/errorTelemetry.ts`).
   */
  telemetry?: ErrorTelemetrySink

  /** Omitted → the auth commands throw and `getAuthState()` reports `signedOut`. */
  authPlatform?: AuthPlatform
  /** Timer seam for proactive refresh + sign-in timeout. Defaults to real timers. */
  scheduler?: Scheduler
  /** `FREESOUND_CLIENT_ID` (public). Required for sign-in. */
  clientId?: string
  onAuthStateChange?: (state: AuthState) => void

  onStagingStatusChange?: (change: StagingStatusChange) => void
  /** Cap on concurrent Original downloads. Defaults to `DOWNLOAD_CONCURRENCY`. */
  stagingConcurrency?: number
  stagingMaxRetries?: number
  /** Backoff before each retry, ms. */
  stagingBackoffMs?: readonly number[]
  /** Cap on total Staged bytes; exceeding it evicts LRU. Library Sounds are never evicted. */
  stagingByteBudget?: number

  /** Omitted → `startDrag` throws and `getDragCapabilities()` reports no drag support. */
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
   * Full-text search through the SQLite cache. A miss costs one gateway call,
   * persists every Sound and prefetches the next page. Failure throws
   * `ThrottledError` / `GatewayError` / `NetworkError` — never an empty list.
   */
  search(query: string, opts?: SearchOptions): Promise<SearchResult>

  /** Debounced `search`: rapid calls collapse into one request for the trailing query. */
  searchDebounced(query: string, opts?: SearchOptions): Promise<SearchResult>

  /** The persisted sort + filter. Neutral prefs when nothing is saved or the blob is bad. */
  getSearchPrefs(): SearchPrefs

  /** Persist the sort + filter. Runs no search — the renderer re-queries itself. */
  setSearchPrefs(prefs: SearchPrefs): SearchPrefs

  /** Window bounds, last view, search text, open Collection and selected Sound. */
  getUiState(): UiState

  /** Persist a patch of shell state. `undefined` keys keep their stored value. */
  setUiState(patch: Partial<UiState>): UiState

  /**
   * How many times the app has launched, this launch included (>= 1). Bumped
   * once per `createCore`. The renderer uses it to hold the Ko-fi splash back
   * until the second launch.
   */
  getLaunchCount(): number

  /** The app's log file path, or `null` when logging is not wired. */
  getLogPath(): string | null

  /** The most recent `maxLines` (default 500) lines of the log, oldest first. */
  readLog(opts?: { maxLines?: number }): string[]

  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void

  /**
   * Record an anonymous error-category event from the renderer (e.g. a failed
   * Preview). No-op unless a `telemetry` sink was provided. Fire-and-forget.
   */
  reportError(event: ClientErrorEvent): void

  /**
   * Sign in through the system browser. Rejects (leaving state `signedOut`) on
   * port-in-use, `state` mismatch, a cancelled/timed-out browser step, or a dead grant.
   */
  signIn(): Promise<AuthState>

  /** Clear the stored tokens only. The Library is left untouched. */
  signOut(): Promise<void>

  getAuthState(): AuthState

  subscribeAuthState(listener: (state: AuthState) => void): () => void

  /**
   * Enqueue a background download of the Original on audition, cancelling the
   * previous audition's download first. A silent no-op while signed out, before
   * consent, or for an unknown Sound.
   */
  stageOnAudition(soundId: number): void

  /**
   * User-initiated download that also saves the Sound to the Library once the
   * bytes land. Needs no consent, never cancels on skip, and counts against the
   * rolling 24 h quota.
   */
  downloadToLibrary(soundId: number, sound?: Sound): void

  /** Originals downloaded from Freesound in the last rolling 24 h (their cap is 2,000). */
  getDownloadsInLast24h(): number

  cancelStaging(soundId: number): void

  /** Per-sound `not-started | queued | downloading | ready | failed`. */
  getStagingStatus(ids: number[]): Record<number, StagingStatus>

  /** Whether the first-run "auditioning downloads sounds" notice was acknowledged. */
  getStagingConsent(): StagingConsent

  /** Record that the user acknowledged the first-run notice. Idempotent. */
  grantStagingConsent(): StagingConsent

  subscribeStagingStatus(listener: (change: StagingStatusChange) => void): () => void

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

  /** Signal that a drag-out has finished (from `dragend`, whatever the outcome). */
  endDrag(soundIds: number | readonly number[]): void

  /** On-disk footprint in bytes, split by intent: `staged`, `library`, `total`. */
  getDiskUsage(): Promise<DiskUsage>

  /**
   * Delete every Staged Original, sidecar and row. The Library is untouched; a
   * Sound with a live Drag-Out is skipped.
   */
  clearStaged(): Promise<EvictionOutcome>

  /**
   * A pure DB write — the Original is never moved or copied. Idempotent (keeps
   * the original `saved_at`). A `sounds` row must exist: pass the `Sound` or this
   * throws. `collectionIds` files it into those Collections in the same
   * transaction; each must exist or this throws first.
   */
  saveToLibrary(
    soundId: number,
    sound?: Sound,
    collectionIds?: readonly number[],
  ): void

  /** Batch "is this in the Library?" for search-result badging. */
  getLibraryMembership(ids: number[]): Record<number, boolean>

  /** Ordered by date saved (`desc` by default). Works offline and while signed out. */
  listLibrary(opts?: { sort?: 'savedAt'; dir?: SortDir }): LibrarySound[]

  /** `listLibrary` narrowed by a structured filter, composing with AND, served from the DB. */
  filterLibrary(
    filter: LibraryFilter,
    opts?: { sort?: 'savedAt'; dir?: SortDir },
  ): LibrarySound[]

  /**
   * Give a Library Sound the user's own name (`null` / `''` clears it). Writes
   * only the overlay; for an Edit the name is also mirrored into its sidecar
   * (best-effort). Throws if the Sound is not in the Library.
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

  setLibraryFilter(filter: LibraryFilter): LibraryFilter

  /**
   * Remove a Sound from the Library and unlink its Original + sidecar. The
   * `sounds` metadata row is kept.
   */
  deleteFromLibrary(soundId: number): Promise<void>

  /** Absolute path to a Sound's Original, or `null` if it is not on disk. */
  getContentPath(soundId: number): string | null

  /** A Sound's page on freesound.org, or `null` if the core has no metadata for it. */
  getFreesoundUrl(soundId: number): string | null

  /** The name is trimmed; empty throws. Names need not be unique. */
  createCollection(name: string): CollectionSummary

  /** The name is trimmed; empty throws. No-op if the id is unknown. */
  renameCollection(collectionId: number, name: string): void

  /** Members stay in the Library and in any other Collection. No-op if the id is unknown. */
  deleteCollection(collectionId: number): void

  /**
   * One transaction, idempotent. Throws if the Collection does not exist or any
   * Sound is not in the Library.
   */
  addToCollection(collectionId: number, soundIds: readonly number[]): void

  /** The Sound stays in the Library and in other Collections. */
  removeFromCollection(collectionId: number, soundId: number): void

  /** Every Collection with its member count, ordered by name. */
  listCollections(): CollectionSummary[]

  /** A Collection's Sounds, most-recently-added first. */
  listCollectionSounds(
    collectionId: number,
    opts?: { dir?: SortDir },
  ): LibrarySound[]

  /** For each requested Sound id, the Collections it belongs to (`[]` when none). */
  getCollectionsForSounds(soundIds: number[]): Record<number, CollectionRef[]>

  /**
   * An Attribution Manifest for a Collection, rendered from the membership at
   * the moment of the call. `manifest.text` is the document to copy verbatim; an
   * empty Collection yields a clear message, not a blank document. Throws if the
   * Collection does not exist.
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

  subscribePeaksStatus(listener: (change: PeaksStatusChange) => void): () => void

  /** The startup health verdict captured before the database was opened. */
  getStartupAssessment(): StartupAssessment

  /**
   * Reconstruct `sounds` rows and Library membership from `<id>.json` sidecars
   * alone. Runs off-thread, reporting via `subscribeRebuildProgress`. Safe to
   * re-run. `orphanAudio` is reported but never deleted; `orphanSidecars` are removed.
   */
  rebuildFromSidecars(): Promise<RebuildReport>

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

  subscribeEditProgress(listener: (event: EditEvent) => void): () => void

  /** Release the database handle and cancel any pending timers. */
  close(): void
}
