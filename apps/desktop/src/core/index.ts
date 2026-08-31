// The core: a plain Node module holding ALL behaviour. NO `electron` import may
// ever appear anywhere under src/core/ (enforced by test/core.no-electron.test.ts).
//
// `createCore` returns an object whose methods ARE the command API. The
// contextBridge preload surface forwards those methods verbatim — the core's
// command API *is* the IPC contract (CONVENTIONS.md, spec 0001).

import { mapRawSound } from './gateway/mapRawSound'
import type { FreesoundGateway, RawSearchPage } from './gateway/index'
import type {
  CollectionRef,
  CollectionSummary,
  LibraryFilter,
  LibrarySound,
  SearchFilter,
  SearchOptions,
  SearchPrefs,
  SearchResult,
  SearchSort,
  Sound,
} from './types'
import {
  DEFAULT_RETRY_AFTER_SECONDS,
  GatewayError,
  ThrottledError,
} from './errors'
import { openDb, type DB } from './db/index'
import { assessStartup, type StartupAssessment } from './startup/assessStartup'
import {
  createRebuildService,
  type RebuildProgress,
  type RebuildReport,
  type RebuildRunner,
  type RebuildService,
} from './rebuild/rebuildService'
import { getMeta, setMeta } from './db/appMeta'
import { getSoundsByIds, upsertSound, upsertSounds } from './db/sounds'
import {
  deleteLibraryEntry,
  getLibraryOverlay,
  hasLibraryEntry,
  libraryMembership,
  listLibraryOverlays,
  saveLibraryEntry,
  setCustomName as dbSetCustomName,
  setCustomTags as dbSetCustomTags,
  type SortDir,
} from './db/library'
import {
  addMembers,
  clearSoundFromAllCollections,
  collectionsForSounds,
  deleteCollectionRow,
  getCollectionName,
  hasCollection,
  insertCollection,
  listCollectionMemberIds,
  listCollectionSummaries,
  removeMember,
  updateCollectionName,
} from './db/collections'
import { buildManifest, type Manifest } from './manifest/buildManifest'
import {
  hasLibraryFilter,
  matchesLibraryFilter,
  normaliseLibraryFilter,
  normaliseTags,
} from './library/libraryFilter'
import { contentPaths, isOriginalOnDisk } from './staging/contentStore'
import { deletePeaksRecord } from './db/peaks'
import {
  createPeakService,
  type PeakRunner,
  type PeakService,
  type PeaksPayload,
  type PeaksStatusChange,
} from './peaks/peakService'
import {
  cacheKey,
  readSearchCache,
  writeSearchCache,
  type SearchCacheParams,
} from './db/searchCache'
import {
  createSearchController,
  type SearchController,
} from './searchController'
import {
  createAuthController,
  createRealScheduler,
  type AuthController,
  type AuthPlatform,
  type AuthState,
  type Scheduler,
} from './auth/index'
import {
  createStagingController,
  type StagingController,
  type StagingConsent,
  type StagingStatus,
  type StagingStatusChange,
} from './staging/stagingController'
import {
  createDragController,
  type DragController,
  type DragStartResult,
  type StartDragOptions,
} from './staging/dragController'
import type { DragHost } from './staging/dragHost'
import { createDragRegistry } from './staging/dragRegistry'
import {
  DEFAULT_STAGING_BYTE_BUDGET,
  removeContentFiles,
  type DiskUsage,
  type EvictionOutcome,
} from './staging/eviction'

export type { FreesoundGateway } from './gateway/index'
export * from './types'
export {
  GatewayError,
  NetworkError,
  NotImplemented,
  ThrottledError,
  DEFAULT_RETRY_AFTER_SECONDS,
} from './errors'
export type {
  AuthPlatform,
  AuthState,
  AuthStatus,
  AwaitLoopbackCodeOptions,
  LoopbackResult,
  Scheduler,
} from './auth/index'
export {
  createRealScheduler,
  LoopbackPortInUseError,
  OAuthStateMismatchError,
  ReauthRequiredError,
  RetryableTokenError,
  SignInCancelledError,
} from './auth/index'
export {
  DOWNLOAD_CONCURRENCY,
  DOWNLOAD_MAX_RETRIES,
  DOWNLOAD_RETRY_BACKOFF_MS,
} from './staging/stagingController'
export type {
  StagingConsent,
  StagingStatus,
  StagingStatusChange,
} from './staging/stagingController'
export { OriginalNotStagedError } from './staging/dragController'
export type {
  DragController,
  DragStartResult,
  StartDragOptions,
} from './staging/dragController'
export {
  createRecordingDragHost,
  type DragHost,
  type DragPayload,
  type RecordingDragHost,
} from './staging/dragHost'
export {
  DEFAULT_STAGING_BYTE_BUDGET,
  type DiskUsage,
  type EvictionOutcome,
} from './staging/eviction'
export type { LibrarySort, SortDir } from './db/library'
export {
  createPeakService,
  workerRunner as createPeakWorkerRunner,
} from './peaks/peakService'
export type {
  PeakRunner,
  PeaksPayload,
  PeaksStatus,
  PeaksStatusChange,
} from './peaks/peakService'
export { BASE_BUCKET_COUNT } from './peaks/computePeaks'
export { inspectDbHealth } from './db/index'
export type { DbHealth } from './db/index'
export { assessStartup, countSidecars } from './startup/assessStartup'
export type { StartupAssessment } from './startup/assessStartup'
export {
  createRebuildService,
  rebuildWorkerRunner as createRebuildWorkerRunner,
  scanSidecars,
  NOT_RECOVERABLE_MESSAGE,
} from './rebuild/rebuildService'
export type {
  RebuildProgress,
  RebuildReport,
  RebuildRecovered,
  RebuildRunner,
  RebuildService,
  SidecarScan,
  ScannedSidecar,
  MalformedSidecar,
} from './rebuild/rebuildService'
export { decodeAudioBuffer, UndecodableAudioError } from './peaks/decodeAudio'
export { computePeaks } from './peaks/computePeaks'
export { buildManifest } from './manifest/buildManifest'
export type {
  Manifest,
  ManifestEntry,
  ManifestSummary,
  ManifestInput,
  ManifestSourceSound,
} from './manifest/buildManifest'
export {
  requiresAttribution,
  restrictsCommercialUse,
} from './manifest/obligations'

const DEFAULT_PAGE_SIZE = 15
const DEBOUNCE_MS = 250

/** `app_meta` key holding the persisted active sort + filter (ticket 15). */
const SEARCH_PREFS_KEY = 'search_prefs'

/** `app_meta` key holding the persisted active Library filter (ticket 13). */
const LIBRARY_FILTER_KEY = 'library_filter'

/** The neutral prefs: relevance order, no filter. */
const DEFAULT_SEARCH_PREFS: SearchPrefs = { sort: 'relevance', filter: {} }

/**
 * Collapse the default sort to `undefined` so a plain query's gateway URL and
 * cache key are byte-for-byte what they were before ticket 15.
 */
function normalizeSort(sort: SearchSort | undefined): SearchSort | undefined {
  return !sort || sort === 'relevance' ? undefined : sort
}

/**
 * Keep only the constraining entries. An all-empty (or absent) filter becomes
 * `undefined`, so it drops out of the cache key entirely and an "unfiltered"
 * query hashes exactly as it did pre-ticket-15 — no migration, no collision.
 */
function normalizeFilter(
  filter: SearchFilter | undefined,
): SearchFilter | undefined {
  if (!filter) return undefined
  const out: SearchFilter = {}
  if (filter.durationMin != null) out.durationMin = filter.durationMin
  if (filter.durationMax != null) out.durationMax = filter.durationMax
  if (filter.sampleRate != null) out.sampleRate = filter.sampleRate
  if (filter.bitDepth != null) out.bitDepth = filter.bitDepth
  if (filter.channels != null) out.channels = filter.channels
  if (filter.fileType) out.fileType = filter.fileType
  if (filter.license) out.license = filter.license
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Read the persisted sort + filter from `app_meta`. Any absence or corruption
 * falls back to the neutral prefs — bad stored state must never wedge search.
 */
function readSearchPrefs(db: DB): SearchPrefs {
  const raw = getMeta(db, SEARCH_PREFS_KEY)
  if (!raw) return { ...DEFAULT_SEARCH_PREFS, filter: {} }
  try {
    const parsed = JSON.parse(raw) as Partial<SearchPrefs>
    return {
      sort: parsed.sort ?? 'relevance',
      filter: normalizeFilter(parsed.filter) ?? {},
    }
  } catch {
    return { ...DEFAULT_SEARCH_PREFS, filter: {} }
  }
}

/**
 * Read the persisted Library filter from `app_meta` (ticket 13). Absence or a
 * corrupt blob falls back to the empty filter — a bad stored value must never
 * wedge the Library view.
 */
function readLibraryFilter(db: DB): LibraryFilter {
  const raw = getMeta(db, LIBRARY_FILTER_KEY)
  if (!raw) return {}
  try {
    return normaliseLibraryFilter(JSON.parse(raw) as LibraryFilter)
  } catch {
    return {}
  }
}

/**
 * The Library as `LibrarySound[]` — every `sounds` row that has a
 * `library_entries` row, merged with the user's overlay (custom name + tags),
 * ordered by date saved, and optionally narrowed by a structured filter. Served
 * ENTIRELY from SQLite: no gateway call, ever.
 */
function readLibrary(
  db: DB,
  dir: SortDir,
  filter?: LibraryFilter,
): LibrarySound[] {
  const overlays = listLibraryOverlays(db, dir)
  const sounds = getSoundsByIds(
    db,
    overlays.map((o) => o.soundId),
  )
  const byId = new Map(sounds.map((s) => [s.id, s]))

  const hydrated: LibrarySound[] = []
  for (const o of overlays) {
    const sound = byId.get(o.soundId)
    if (!sound) continue // a lost `sounds` row — skip rather than throw
    hydrated.push({
      ...sound,
      customName: o.customName,
      effectiveName: o.customName ?? sound.name,
      customTags: o.customTags,
      savedAt: o.savedAt,
    })
  }

  if (!hasLibraryFilter(filter)) return hydrated
  const f = normaliseLibraryFilter(filter)
  return hydrated.filter((s) => matchesLibraryFilter(s, f))
}

/**
 * A Collection's Sounds as `LibrarySound[]` — the same hydrated shape
 * `readLibrary` produces (Sound + the user's custom name / tags / `savedAt`), so
 * a Collection browses in the identical list UI with identical playback, drag
 * and rename behaviour. Members are ordered most-recently-added first (`dir`
 * flips it). Served ENTIRELY from SQLite: no gateway call, ever.
 */
function readCollectionSounds(
  db: DB,
  collectionId: number,
  dir: SortDir,
): LibrarySound[] {
  const ids = listCollectionMemberIds(db, collectionId, dir)
  const sounds = getSoundsByIds(db, ids)
  const byId = new Map(sounds.map((s) => [s.id, s]))

  const hydrated: LibrarySound[] = []
  for (const id of ids) {
    const sound = byId.get(id)
    if (!sound) continue // a lost `sounds` row — skip rather than throw
    const o = getLibraryOverlay(db, id)
    if (!o) continue // no longer in the Library — skip
    hydrated.push({
      ...sound,
      customName: o.customName,
      effectiveName: o.customName ?? sound.name,
      customTags: o.customTags,
      savedAt: o.savedAt,
    })
  }
  return hydrated
}

export interface CoreDeps {
  /** The sole network boundary. */
  gateway: FreesoundGateway
  /** App data directory (Electron `userData` in production; a temp dir in tests). */
  dataDir: string
  /** Path to the SQLite database file. Opened here — never on the renderer thread. */
  dbPath: string
  /** Debounce window for `searchDebounced`, ms. Defaults to 250. Tests shrink it. */
  debounceMs?: number

  // ---- auth (ticket 07) --------------------------------------------------
  /**
   * The three OS capabilities the core cannot provide for itself: system
   * browser, one-shot loopback listener, `safeStorage`. Real Electron impl in
   * `src/main/`, fake in tests. When omitted, the auth commands throw and
   * `getAuthState()` reports `signedOut` — search/preview still work.
   */
  authPlatform?: AuthPlatform
  /** Timer seam for proactive refresh + sign-in timeout. Defaults to real timers. */
  scheduler?: Scheduler
  /** `FREESOUND_CLIENT_ID` (public). Required for sign-in. */
  clientId?: string
  /** Broadcast every auth-state transition (main forwards it to the renderer). */
  onAuthStateChange?: (state: AuthState) => void

  // ---- staging (ticket 08) ---------------------------------------------
  /** Broadcast every per-sound staging status change (main forwards it to the renderer). */
  onStagingStatusChange?: (change: StagingStatusChange) => void
  /** Cap on concurrent Original downloads. Defaults to `DOWNLOAD_CONCURRENCY` (3). Tests shrink it. */
  stagingConcurrency?: number
  /** Retry attempts after a transient download failure. Defaults to 3. */
  stagingMaxRetries?: number
  /** Backoff before each retry, ms. Defaults to `[1000, 3000, 9000]`. */
  stagingBackoffMs?: readonly number[]

  // ---- eviction (ticket 10) -------------------------------------------
  /**
   * Cap on total bytes of Staged (auditioned-but-unsaved) Originals on disk.
   * After a stage pushes the total past this, least-recently-accessed Staged
   * Sounds are evicted — Original + sidecar + row together — until it fits.
   * Library Sounds and Sounds with a live Drag-Out are never evicted. Runs
   * silently, off the hot path. Defaults to `DEFAULT_STAGING_BYTE_BUDGET`
   * (2 GiB). Tests shrink it.
   */
  stagingByteBudget?: number

  // ---- drag-out (ticket 09) ------------------------------------------
  /**
   * The single OS drag-and-drop boundary (`webContents.startDrag`). Real impl
   * in `src/main/`, a recording fake in tests. When omitted, `startDrag` throws
   * and `getDragCapabilities()` reports no drag support — search/preview/staging
   * are unaffected.
   */
  dragHost?: DragHost
  /**
   * Absolute path to the bundled fallback drag icon (a waveform glyph), used
   * when the renderer cannot supply the Sound's own waveform as the drag image.
   * Guarantees `startDrag` never hands the OS an empty icon.
   */
  dragIconFallbackPath?: string

  // ---- computed peaks (ticket 12) ----------------------------------
  /**
   * Absolute path to the built `peakWorker.js`. When set, waveform-peak
   * computation runs on a `node:worker_threads` thread — off both the Electron
   * main process and the renderer. `src/main` passes `out/main/peakWorker.js`.
   */
  peakWorkerPath?: string
  /**
   * Test seam: replace the peak computation runner entirely (run it in-process,
   * synchronously or behind a controllable promise). Wins over `peakWorkerPath`.
   */
  computePeaksRunner?: PeakRunner
  /** Broadcast every per-sound peaks status change (main forwards it to the renderer). */
  onPeaksStatusChange?: (change: PeaksStatusChange) => void

  // ---- rebuild from sidecars (ticket 14) --------------------------------
  /**
   * Absolute path to the built `rebuildWorker.js`. When set, the content-store
   * scan for `rebuildFromSidecars` runs on a `node:worker_threads` thread — off
   * the Electron main process. `src/main` passes `out/main/rebuildWorker.js`.
   */
  rebuildWorkerPath?: string
  /**
   * Test seam: replace the sidecar-scan runner entirely (in-process, or behind a
   * controllable promise to prove `rebuildFromSidecars` does not block). Wins
   * over `rebuildWorkerPath`.
   */
  rebuildRunner?: RebuildRunner
  /** Broadcast sidecar-scan progress `{ done, total }` (main forwards it to the renderer). */
  onRebuildProgress?: (progress: RebuildProgress) => void
}

/** The command API. Later tickets add methods here; the bridge forwards them all. */
export interface Core {
  /**
   * Full-text search against Freesound, through the SQLite search cache.
   *
   * A cache HIT (same fully-normalized query — text, page, pageSize, and any
   * future sort/filter params) is served entirely from the DB with ZERO gateway
   * calls, which makes back-navigation and repeated queries free.
   *
   * A cache MISS costs exactly one gateway call: every returned `Sound` is
   * persisted into `sounds`, the page's id list + `totalCount` + `hasMore` is
   * written to `search_cache` (kept indefinitely), and the NEXT page is
   * prefetched in the background so a scroll never stalls.
   *
   * An empty result set returns `{ totalCount: 0, sounds: [] }`. A failure throws
   * a typed error — `ThrottledError` (429, with `retryAfter` seconds),
   * `GatewayError`, or `NetworkError` — never an empty list, and never a bogus
   * empty cache row.
   */
  search(query: string, opts?: SearchOptions): Promise<SearchResult>

  /**
   * Debounced `search`: rapid calls within the debounce window collapse into a
   * single gateway request for the trailing query. The renderer calls this on
   * every keystroke; the debounce lives here so it is tested at the core seam.
   */
  searchDebounced(query: string, opts?: SearchOptions): Promise<SearchResult>

  /**
   * The persisted active sort + filter state (ticket 15). Read once on startup
   * so the renderer restores the last session's sort and filters. Returns
   * `{ sort: 'relevance', filter: {} }` when nothing has been saved yet or the
   * stored blob is unreadable.
   */
  getSearchPrefs(): SearchPrefs

  /**
   * Persist the active sort + filter state (ticket 15) into `app_meta` so it
   * survives an app restart. The renderer calls this whenever the user changes
   * the sort or a filter; it does NOT run a search — the renderer re-runs the
   * query itself with the new options.
   */
  setSearchPrefs(prefs: SearchPrefs): SearchPrefs

  /**
   * Sign in through the system browser (ticket 07). Opens Freesound's authorize
   * page, catches the code on the loopback listener, exchanges it via the Worker,
   * shows the username, and stays signed in for days with proactive refresh.
   * Rejects (leaving state `signedOut`) on port-in-use, `state` mismatch, a
   * cancelled/timed-out browser step, or a dead grant.
   */
  signIn(): Promise<AuthState>

  /**
   * Sign out: clear the stored tokens only. The Library, downloaded Originals,
   * Collections and every other table are left untouched (CONTEXT.md § Account).
   */
  signOut(): Promise<void>

  /** Current auth state: `signedIn` / `signedOut` / `signingIn` + `username`. */
  getAuthState(): AuthState

  /**
   * Subscribe to auth-state transitions. Returns an unsubscribe function. Used
   * by the main process to push state to the renderer over a `core:event`
   * channel; the renderer itself reads `getAuthState()` + that event.
   */
  subscribeAuthState(listener: (state: AuthState) => void): () => void

  // ---- staging (ticket 08) ---------------------------------------------

  /**
   * The renderer's audition flow calls this on every play (fire-and-forget). The
   * core streams the Preview elsewhere; here it enqueues a BACKGROUND download of
   * the Original so the Sound is on disk and draggable a moment later. It first
   * cancels the previous audition's download unless that one already finished or
   * was saved, so skimming a list never leaves dozens of downloads running.
   *
   * A silent no-op while signed out, before the first-run consent is granted, or
   * for a Sound the core has no metadata for. If the Original is already on disk
   * it just refreshes the staged `last_access_at`.
   */
  stageOnAudition(soundId: number): void

  /** Cancel a sound's queued/in-flight staged download (renderer calls this on Stop). */
  cancelStaging(soundId: number): void

  /**
   * Per-sound staging status for the row indicator:
   * `not-started | queued | downloading | ready | failed`.
   */
  getStagingStatus(ids: number[]): Record<number, StagingStatus>

  /** Whether the first-run "auditioning downloads sounds" notice was acknowledged. */
  getStagingConsent(): StagingConsent

  /** Record that the user acknowledged the first-run notice. Idempotent. */
  grantStagingConsent(): StagingConsent

  /**
   * Subscribe to per-sound staging status transitions. Returns an unsubscribe
   * function. The main process forwards these over `core:event:stagingStatus`.
   */
  subscribeStagingStatus(
    listener: (change: StagingStatusChange) => void,
  ): () => void

  // ---- drag-out (ticket 09) ------------------------------------------

  /**
   * Begin an OS drag-out of one or more Sounds whose Originals are on disk.
   * Hardlinks each Original into a temp directory under a sanitised,
   * human-readable name and hands those paths to the OS through `DragHost` — the
   * content-store path (`<id>.<ext>`) is never dragged, and a Preview is never
   * substituted. Throws `OriginalNotStagedError` (never a silent no-op) if a
   * requested Sound's Original is not yet staged. A multi-Sound request collapses
   * to the first Sound on platforms where ticket 01 did not verify that every
   * file is delivered.
   */
  startDrag(
    soundIds: number | readonly number[],
    opts?: StartDragOptions,
  ): DragStartResult

  /**
   * Drag capabilities for the current platform. `multiSound` is true only where
   * ticket 01 verified multi-file drag delivers every file (macOS); the UI must
   * not offer multi-Sound drag when it is false.
   */
  getDragCapabilities(): { multiSound: boolean }

  /**
   * Signal that an OS drag-out of these Sounds has finished (the renderer calls
   * this from `dragend`, whatever the drop outcome). It releases the
   * eviction-skip hold that `startDrag` placed on each Sound's Original. Safe to
   * call with unknown ids, and harmless if a matching `startDrag` never ran — an
   * unreleased hold also self-expires after a short TTL.
   */
  endDrag(soundIds: number | readonly number[]): void

  // ---- eviction & disk usage (ticket 10) -----------------------------

  /**
   * Current on-disk footprint in bytes, split by intent: `staged` (auditioned
   * but unsaved), `library` (explicitly kept), and their `total`. For the "disk
   * usage" panel — the only place staging size is ever surfaced to the user.
   */
  getDiskUsage(): Promise<DiskUsage>

  /**
   * Delete every Staged Original, its sidecar and its `staged_entries` row to
   * reclaim space now, without waiting for the byte budget to force it. The
   * Library is left completely untouched; a Sound with a live Drag-Out is
   * skipped. Resolves with what was removed (`evicted`, `freedBytes`) and what
   * was spared (`skipped`).
   */
  clearStaged(): Promise<EvictionOutcome>

  // ---- library (ticket 11) -----------------------------------------

  /**
   * Save a Sound to the Library — the user's statement of intent to KEEP it
   * (CONTEXT.md § Library). This is a pure DB write: one `library_entries` row
   * with `saved_at = now`, and — if the Sound was Staged — its `staged_entries`
   * row is dropped in the same transaction. The Original is NEVER moved or
   * copied; the bytes already on disk simply change owner, which is what makes
   * saving instant (ADR-0003).
   *
   * IDEMPOTENT: saving an already-saved Sound keeps the original `saved_at` and
   * never creates a duplicate — a harmless no-op, never a throw.
   *
   * A `sounds` row must exist. Pass the `Sound` (a search result or a Staged
   * Sound always carries one) and it is upserted first; if none is passed and no
   * row exists, this throws rather than saving a Sound with no metadata.
   *
   * `collectionIds` files the Sound into those Collections in the SAME
   * transaction as the save (ticket 16) — so filing at save time is one action,
   * not a separate step. Each id must be an existing Collection or this throws
   * (before writing anything). Idempotent per Collection.
   */
  saveToLibrary(
    soundId: number,
    sound?: Sound,
    collectionIds?: readonly number[],
  ): void

  /**
   * Batch "is this in the Library?" for search-result badging, so the user does
   * not download the same thing twice. One cheap indexed query; every requested
   * id appears in the result (`false` when absent).
   */
  getLibraryMembership(ids: number[]): Record<number, boolean>

  /**
   * The Library as `LibrarySound[]` (each `Sound` merged with the user's overlay
   * — custom name + custom tags + `savedAt`), ordered by the date each was saved.
   * `dir` defaults to `desc` (newest-saved first — "what did I gather for this
   * project"). Makes NO gateway call: served entirely from the local `sounds` +
   * `library_entries` tables, so it works fully offline and while signed out.
   */
  listLibrary(opts?: { sort?: 'savedAt'; dir?: SortDir }): LibrarySound[]

  /**
   * The Library narrowed by a structured filter (ticket 13) — by tag, License,
   * duration, file format and/or a free-text term, composing with AND. Served
   * ENTIRELY from the database: it never issues a network request, so it is
   * instant and works offline. An absent / all-empty filter is identical to
   * `listLibrary`.
   */
  filterLibrary(
    filter: LibraryFilter,
    opts?: { sort?: 'savedAt'; dir?: SortDir },
  ): LibrarySound[]

  /**
   * Give a Library Sound the user's own name (or clear it with `null` / `''`).
   * Writes ONLY `library_entries.custom_name` — the Sound's author, License,
   * Freesound name and URL are untouched, so the link to the original is never
   * severed. The custom name is what a Drag-Out delivers on the file (sanitised
   * for the filesystem at drag time); the Freesound name is used when it is
   * unset. Throws if the Sound is not in the Library.
   */
  setCustomName(soundId: number, customName: string | null): void

  /**
   * Replace a Library Sound's own tag list (ticket 13) — the user's tags, kept
   * separate from the tags inherited from Freesound. Tags are trimmed, de-duped
   * (case-insensitively) and empties dropped. Pass `[]` to clear them. Throws if
   * the Sound is not in the Library.
   */
  setLibraryTags(soundId: number, tags: string[]): void

  /**
   * The persisted active Library filter (ticket 13), restored on startup so the
   * Library view reopens with the user's last filter. `{}` when nothing is saved
   * or the stored blob is unreadable.
   */
  getLibraryFilter(): LibraryFilter

  /**
   * Persist the active Library filter (ticket 13) into `app_meta`. Does NOT run a
   * query — the renderer re-reads the Library itself with the new filter.
   */
  setLibraryFilter(filter: LibraryFilter): LibraryFilter

  /**
   * Remove a Sound from the Library: delete its `library_entries` row AND unlink
   * its Original + sidecar to reclaim disk (Original first, so no orphan audio).
   * The `sounds` metadata row is kept — the Sound may reappear as an ordinary
   * search result, just without a Library badge. Makes NO gateway call.
   */
  deleteFromLibrary(soundId: number): Promise<void>

  /**
   * Absolute path to a Sound's Original in the content store, or `null` if it is
   * not on disk. Pure data for the main process's `shell.showItemInFolder`
   * ("reveal in Finder/Explorer") — the core cannot call `shell` itself.
   */
  getContentPath(soundId: number): string | null

  /**
   * A Sound's page on freesound.org, or `null` if the core has no metadata for
   * it. Pure data for the main process's `shell.openExternal` ("open on
   * freesound.org").
   */
  getFreesoundUrl(soundId: number): string | null

  // ---- collections (ticket 16) -----------------------------------------

  /**
   * Create a named Collection (CONTEXT.md § Collection). The name is trimmed;
   * an empty name throws. Returns the new Collection with `count: 0`. Names are
   * not required to be unique — two "Weather" Collections are allowed.
   */
  createCollection(name: string): CollectionSummary

  /** Rename a Collection. The name is trimmed; an empty name throws. No-op if the id is unknown. */
  renameCollection(collectionId: number, name: string): void

  /**
   * Delete a Collection. Removes ONLY the `collections` row and its
   * `collection_members` rows — every member Sound stays in the Library and in
   * any other Collection. The renderer confirms with the user first
   * (`window.confirm`, consistent with the Library delete). No-op if unknown.
   */
  deleteCollection(collectionId: number): void

  /**
   * Add one or more Sounds to a Collection in a single transaction. Idempotent —
   * a Sound already in the Collection is untouched and never duplicated, so
   * batch-adding a mixed selection is safe. Throws if the Collection does not
   * exist, or if any Sound is not in the Library (a Collection is a set of
   * Library Sounds — a Staged Sound cannot belong to one).
   */
  addToCollection(collectionId: number, soundIds: readonly number[]): void

  /**
   * Remove a Sound from a Collection. Deletes only the membership — the Sound
   * stays in the Library and in every other Collection it belongs to. No-op if
   * the Sound was not in the Collection.
   */
  removeFromCollection(collectionId: number, soundId: number): void

  /**
   * Every Collection with its current member count, ordered by name. Served
   * entirely from the database — no gateway call.
   */
  listCollections(): CollectionSummary[]

  /**
   * A Collection's Sounds as `LibrarySound[]` (Sound + the user's custom name /
   * tags), most-recently-added first (`dir` flips it). Served ENTIRELY from the
   * local database — it makes NO gateway call (a test asserts this) — so a
   * Collection browses, plays and drags exactly like the Library, offline and
   * signed out.
   */
  listCollectionSounds(
    collectionId: number,
    opts?: { dir?: SortDir },
  ): LibrarySound[]

  /**
   * For each requested Sound id, the Collections it belongs to (`{ id, name }`).
   * Every requested id is present in the result (mapped to `[]` when the Sound
   * is in no Collection). Drives the per-row "in these Collections" badges.
   */
  getCollectionsForSounds(
    soundIds: number[],
  ): Record<number, CollectionRef[]>

  /**
   * Generate an Attribution Manifest for a Collection (ticket 17) — a
   * human-readable credits document naming every member Sound's title, author,
   * License and Freesound URL, grouping attribution-required Sounds apart from
   * CC0, and flagging any Sound licensed for non-commercial use only.
   *
   * The result is a SNAPSHOT: it is rendered from the Collection's membership at
   * the moment of the call and is a plain value — it does not change when the
   * Collection is edited afterwards. `manifest.text` is the plain-text document
   * to copy or save verbatim.
   *
   * An empty Collection returns a Manifest whose `text` is a clear message, not
   * a blank document. Throws if the Collection does not exist.
   */
  generateManifest(collectionId: number): Manifest

  // ---- computed peaks & canvas waveform (ticket 12) ----------------

  /**
   * Cached waveform peaks for a Sound, or `null` when there are none — the
   * Original is not on disk, or it could not be decoded, or computation has not
   * finished yet. The renderer draws a sharp <canvas> waveform from these and
   * falls back to the Freesound waveform image on `null` (no discontinuity when
   * peaks later arrive). Reads the SQLite cache only — never computes — so it is
   * instant on every revisit.
   */
  getPeaks(soundId: number): PeaksPayload | null

  /**
   * Ensure peaks exist for a Sound. Returns immediately: if peaks are cached the
   * status is announced synchronously, otherwise — when the Original is on disk —
   * decoding + the min/max sweep run OFF this thread (a `worker_threads` Worker
   * in production) and the outcome is announced when done. Deduped per Sound and
   * computed at most once ever (an undecodable Original is remembered as such).
   * The long computation of a long recording never blocks this call or any other
   * command.
   */
  requestPeaks(soundId: number): void

  /**
   * Subscribe to per-sound peaks status transitions (`ready` / `unavailable`).
   * Returns an unsubscribe function. The main process forwards these over
   * `core:event:peaksStatus`; the renderer re-reads `getPeaks` on `ready`.
   */
  subscribePeaksStatus(
    listener: (change: PeaksStatusChange) => void,
  ): () => void

  // ---- rebuild from sidecars (ticket 14) --------------------------------

  /**
   * The startup health verdict, captured BEFORE the database was opened: whether
   * the DB file was usable, how many sidecars are in the content store, and
   * whether the renderer should offer a rebuild rather than show an empty
   * Library. Carries `notRecoverable` — the sentence to show the user first.
   */
  getStartupAssessment(): StartupAssessment

  /**
   * Reconstruct `sounds` rows and Library membership from the content store's
   * `<id>.json` sidecars alone — the recovery path ADR-0002 promises. The scan
   * runs OFF the main thread (a Worker in production) and reports progress via
   * `subscribeRebuildProgress`; this call returns as soon as the scan resolves
   * and never blocks other commands while it runs.
   *
   * Returns a structured report: what was `recovered` (each with author +
   * License), `orphanAudio` (Originals with no sidecar — reported, never
   * imported, never deleted), `orphanSidecars` (sidecars with no Original —
   * reported and their `.json` removed), `malformed` (bad sidecars, reported
   * individually — one never aborts the run), and `notRecoverable` (custom
   * names, custom tags and Collections). Safe to re-run.
   */
  rebuildFromSidecars(): Promise<RebuildReport>

  /**
   * Subscribe to sidecar-scan progress (`{ done, total }`) during a
   * `rebuildFromSidecars` run. Returns an unsubscribe function. The main process
   * forwards these over `core:event:rebuildProgress`.
   */
  subscribeRebuildProgress(listener: (p: RebuildProgress) => void): () => void

  /** Release the database handle and cancel any pending debounced/refresh timers. */
  close(): void
}

/**
 * Stand-in when the core is built without `authPlatform` (some unit tests, and
 * any environment where OAuth is not configured). Search and Preview never touch
 * this — they are token-auth.
 */
function unconfiguredAuth(
  onStateChange?: (s: AuthState) => void,
): AuthController {
  const state: AuthState = {
    status: 'signedOut',
    username: null,
    reauthRequired: false,
  }
  const notConfigured = () =>
    Promise.reject(
      new Error(
        'Authentication is not configured (missing AuthPlatform / FREESOUND_CLIENT_ID).',
      ),
    )
  onStateChange?.(state)
  return {
    signIn: notConfigured as AuthController['signIn'],
    signOut: () => Promise.resolve(),
    getState: () => state,
    subscribe: () => () => {},
    authorized: notConfigured as AuthController['authorized'],
    close: () => {},
  }
}

export function createCore(deps: CoreDeps): Core {
  const { gateway, dbPath, debounceMs = DEBOUNCE_MS } = deps

  // Capture the DB + sidecar health BEFORE `openDb` — it would recreate a
  // missing or blank schema and hide the very condition a rebuild responds to.
  const startupAssessment = assessStartup({ dbPath, dataDir: deps.dataDir })

  const db: DB = openDb(dbPath)

  const scheduler: Scheduler = deps.scheduler ?? createRealScheduler()

  const auth: AuthController =
    deps.authPlatform && deps.scheduler
      ? createAuthController({
          gateway,
          platform: deps.authPlatform,
          scheduler: deps.scheduler,
          db,
          clientId: deps.clientId ?? '',
          onStateChange: deps.onAuthStateChange,
        })
      : unconfiguredAuth(deps.onAuthStateChange)

  // The seam eviction uses to skip Sounds with a live Drag-Out. Shared by the
  // drag controller (which marks drags in-flight) and staging (which evicts).
  const dragRegistry = createDragRegistry()

  // Computed waveform peaks (ticket 12). Decoding + the min/max sweep run off
  // this thread; results are cached in the `peaks` table and served instantly.
  const peakService: PeakService = createPeakService({
    db,
    dataDir: deps.dataDir,
    peakWorkerPath: deps.peakWorkerPath,
    runner: deps.computePeaksRunner,
    onStatusChange: deps.onPeaksStatusChange,
  })

  // Rebuild from sidecars (ticket 14). The content-store scan runs off this
  // thread (a Worker in production; an injected runner under test).
  const rebuild: RebuildService = createRebuildService({
    db,
    dataDir: deps.dataDir,
    rebuildWorkerPath: deps.rebuildWorkerPath,
    runner: deps.rebuildRunner,
    onProgress: deps.onRebuildProgress,
  })

  const staging: StagingController = createStagingController({
    db,
    dataDir: deps.dataDir,
    gateway,
    auth,
    scheduler,
    onStatusChange: deps.onStagingStatusChange,
    onOriginalReady: (soundId) => peakService.requestPeaks(soundId),
    byteBudget: deps.stagingByteBudget ?? DEFAULT_STAGING_BYTE_BUDGET,
    inFlightDrags: dragRegistry,
    concurrency: deps.stagingConcurrency,
    maxRetries: deps.stagingMaxRetries,
    backoffMs: deps.stagingBackoffMs,
  })

  const drag: DragController | undefined = deps.dragHost
    ? createDragController({
        db,
        dataDir: deps.dataDir,
        dragHost: deps.dragHost,
        fallbackIconPath: deps.dragIconFallbackPath,
        dragRegistry,
      })
    : undefined

  function requireDrag(): DragController {
    if (!drag) {
      throw new Error('Drag-out is not configured (no DragHost was provided).')
    }
    return drag
  }

  // Keyed by cache key. Holds BOTH foreground searches and background prefetches,
  // so a real request for a page already being prefetched attaches to the same
  // promise instead of issuing a second gateway call — and duplicate prefetches
  // are impossible.
  const inFlight = new Map<string, Promise<SearchResult>>()

  function fromCache(
    query: string,
    page: number,
    pageSize: number,
    cached: NonNullable<ReturnType<typeof readSearchCache>>,
  ): SearchResult {
    return {
      query,
      totalCount: cached.totalCount,
      page,
      pageSize,
      sounds: getSoundsByIds(db, cached.soundIds),
      hasMore: cached.hasMore,
    }
  }

  async function fetchAndStore(
    query: string,
    page: number,
    pageSize: number,
    sort: SearchSort | undefined,
    filter: SearchFilter | undefined,
    ck: ReturnType<typeof cacheKey>,
    allowPrefetch: boolean,
  ): Promise<SearchResult> {
    let raw: RawSearchPage
    try {
      // `sort` / `filter` only ride along when they constrain something, so an
      // unfiltered query's gateway call is unchanged (and the fake records the
      // bare `{ query, page, pageSize }` older tests assert on).
      raw = await gateway.search({
        query: query.trim(),
        page,
        pageSize,
        ...(sort ? { sort } : {}),
        ...(filter ? { filter } : {}),
      })
    } catch (err) {
      // A failure on a MISS propagates as a typed error and writes NOTHING —
      // no empty cache row, so a later retry still reaches the gateway.
      throw asTypedError(err)
    }

    const sounds = raw.results.map(mapRawSound)
    const hasMore = sounds.length > 0 && page * pageSize < raw.count

    upsertSounds(db, sounds)
    writeSearchCache(db, ck, {
      soundIds: sounds.map((s) => s.id),
      totalCount: raw.count,
      hasMore,
    })

    // Prefetch MUST carry the same sort + filter, or page 2 would be fetched
    // unfiltered and cached under this filtered query's next-page key.
    if (allowPrefetch && hasMore) {
      prefetchNextPage(query, page, pageSize, sort, filter)
    }

    return { query, totalCount: raw.count, page, pageSize, sounds, hasMore }
  }

  function runSearch(
    query: string,
    opts: SearchOptions | undefined,
    allowPrefetch: boolean,
  ): Promise<SearchResult> {
    const page = opts?.page ?? 1
    const pageSize = opts?.pageSize ?? DEFAULT_PAGE_SIZE
    const sort = normalizeSort(opts?.sort)
    const filter = normalizeFilter(opts?.filter)
    const trimmed = query.trim()

    if (trimmed === '') {
      return Promise.resolve({
        query,
        totalCount: 0,
        page,
        pageSize,
        sounds: [],
        hasMore: false,
      })
    }

    // `sort` / `filter` are part of the params object, so `cacheKey` (a hash of
    // the canonical JSON) puts a differently-sorted or differently-filtered
    // query on its own row — cached and served independently, no collision.
    const params: SearchCacheParams = {
      query: trimmed,
      page,
      pageSize,
      sort,
      filter,
    }
    const ck = cacheKey(params)

    const cached = readSearchCache(db, ck.key)
    if (cached) return Promise.resolve(fromCache(query, page, pageSize, cached))

    const existing = inFlight.get(ck.key)
    if (existing) return existing

    const p = fetchAndStore(
      query,
      page,
      pageSize,
      sort,
      filter,
      ck,
      allowPrefetch,
    ).finally(() => {
      inFlight.delete(ck.key)
    })
    inFlight.set(ck.key, p)
    return p
  }

  function prefetchNextPage(
    query: string,
    page: number,
    pageSize: number,
    sort: SearchSort | undefined,
    filter: SearchFilter | undefined,
  ): void {
    const nextParams: SearchCacheParams = {
      query: query.trim(),
      page: page + 1,
      pageSize,
      sort,
      filter,
    }
    const { key } = cacheKey(nextParams)
    if (inFlight.has(key) || readSearchCache(db, key)) return
    // Fire-and-forget; errors are swallowed. `allowPrefetch: false` so prefetch
    // never chains into prefetching page+2, page+3, … The sort/filter are
    // already normalized; passing them back through `runSearch` is idempotent.
    void runSearch(
      query,
      { page: page + 1, pageSize, sort, filter },
      false,
    ).catch(() => {})
  }

  const controller: SearchController = createSearchController(
    { search: (q, o) => runSearch(q, o, true) },
    { debounceMs },
  )

  return {
    search: (query, opts) => runSearch(query, opts, true),
    searchDebounced: (query, opts) => controller.query(query, opts),
    getSearchPrefs: () => readSearchPrefs(db),
    setSearchPrefs: (prefs) => {
      const clean: SearchPrefs = {
        sort: prefs.sort ?? 'relevance',
        filter: normalizeFilter(prefs.filter) ?? {},
      }
      setMeta(db, SEARCH_PREFS_KEY, JSON.stringify(clean))
      return clean
    },
    signIn: () => auth.signIn(),
    signOut: () => auth.signOut(),
    getAuthState: () => auth.getState(),
    subscribeAuthState: (listener) => auth.subscribe(listener),
    stageOnAudition: (soundId) => staging.stageOnAudition(soundId),
    cancelStaging: (soundId) => staging.cancelStaging(soundId),
    getStagingStatus: (ids) => staging.getStagingStatus(ids),
    getStagingConsent: () => staging.getStagingConsent(),
    grantStagingConsent: () => staging.grantStagingConsent(),
    subscribeStagingStatus: (listener) => staging.subscribe(listener),
    startDrag: (soundIds, opts) => requireDrag().startDrag(soundIds, opts),
    getDragCapabilities: () => ({
      multiSound: drag?.multiSoundDragSupported ?? false,
    }),
    endDrag: (soundIds) =>
      dragRegistry.end(typeof soundIds === 'number' ? [soundIds] : soundIds),
    getDiskUsage: () => staging.getDiskUsage(),
    clearStaged: () => staging.clearStaged(),

    saveToLibrary: (soundId, sound, collectionIds) => {
      if (sound) upsertSound(db, sound)
      if (!getSoundsByIds(db, [soundId])[0]) {
        throw new Error(
          `saveToLibrary: no metadata for sound ${soundId} — search or audition it first`,
        )
      }
      const fileInto = collectionIds ?? []
      for (const cid of fileInto) {
        if (!hasCollection(db, cid)) {
          throw new Error(`saveToLibrary: no collection ${cid}`)
        }
      }
      const now = Date.now()
      const tx = db.transaction(() => {
        saveLibraryEntry(db, soundId, now)
        for (const cid of fileInto) addMembers(db, cid, [soundId], now)
      })
      tx()
    },
    getLibraryMembership: (ids) => libraryMembership(db, ids),
    listLibrary: (opts) => readLibrary(db, opts?.dir ?? 'desc'),
    filterLibrary: (filter, opts) =>
      readLibrary(db, opts?.dir ?? 'desc', filter),
    setCustomName: (soundId, customName) => {
      if (!hasLibraryEntry(db, soundId)) {
        throw new Error(
          `setCustomName: sound ${soundId} is not in the Library — save it first`,
        )
      }
      const trimmed = (customName ?? '').trim()
      dbSetCustomName(db, soundId, trimmed === '' ? null : trimmed)
    },
    setLibraryTags: (soundId, tags) => {
      if (!hasLibraryEntry(db, soundId)) {
        throw new Error(
          `setLibraryTags: sound ${soundId} is not in the Library — save it first`,
        )
      }
      dbSetCustomTags(db, soundId, normaliseTags(tags))
    },
    getLibraryFilter: () => readLibraryFilter(db),
    setLibraryFilter: (filter) => {
      const clean = normaliseLibraryFilter(filter)
      setMeta(db, LIBRARY_FILTER_KEY, JSON.stringify(clean))
      return clean
    },
    deleteFromLibrary: async (soundId) => {
      const sound = getSoundsByIds(db, [soundId])[0]
      db.transaction(() => {
        deleteLibraryEntry(db, soundId)
        // Ticket 16: a Sound leaving the Library leaves every Collection too.
        // The `sounds` row is kept here, so the FK cascade does not fire —
        // clear the memberships explicitly.
        clearSoundFromAllCollections(db, soundId)
        // Cached peaks (ticket 12) die with the Original.
        deletePeaksRecord(db, soundId)
      })()
      if (sound) await removeContentFiles(deps.dataDir, sound)
    },
    getPeaks: (soundId) => peakService.getPeaks(soundId),
    requestPeaks: (soundId) => peakService.requestPeaks(soundId),
    subscribePeaksStatus: (listener) => peakService.subscribe(listener),
    getContentPath: (soundId) => {
      const sound = getSoundsByIds(db, [soundId])[0]
      if (!sound || !isOriginalOnDisk(deps.dataDir, sound)) return null
      return contentPaths(deps.dataDir, sound).original
    },
    getFreesoundUrl: (soundId) => getSoundsByIds(db, [soundId])[0]?.url ?? null,

    createCollection: (name) => {
      const clean = name.trim()
      if (clean === '') throw new Error('createCollection: name is empty')
      const id = insertCollection(db, clean, Date.now())
      return { id, name: clean, count: 0 }
    },
    renameCollection: (collectionId, name) => {
      const clean = name.trim()
      if (clean === '') throw new Error('renameCollection: name is empty')
      updateCollectionName(db, collectionId, clean)
    },
    deleteCollection: (collectionId) => deleteCollectionRow(db, collectionId),
    addToCollection: (collectionId, soundIds) => {
      if (!hasCollection(db, collectionId)) {
        throw new Error(`addToCollection: no collection ${collectionId}`)
      }
      for (const id of soundIds) {
        if (!hasLibraryEntry(db, id)) {
          throw new Error(
            `addToCollection: sound ${id} is not in the Library — save it first`,
          )
        }
      }
      addMembers(db, collectionId, soundIds, Date.now())
    },
    removeFromCollection: (collectionId, soundId) =>
      removeMember(db, collectionId, soundId),
    listCollections: () => listCollectionSummaries(db),
    listCollectionSounds: (collectionId, opts) =>
      readCollectionSounds(db, collectionId, opts?.dir ?? 'desc'),
    getCollectionsForSounds: (soundIds) => collectionsForSounds(db, soundIds),
    generateManifest: (collectionId) => {
      const name = getCollectionName(db, collectionId)
      if (name === null) {
        throw new Error(`generateManifest: no collection ${collectionId}`)
      }
      // Same hydrated, DB-only read the Collection view uses — no gateway call.
      // Members come back most-recently-added first; the Manifest keeps that order.
      const sounds = readCollectionSounds(db, collectionId, 'desc')
      return buildManifest({
        collectionId,
        collectionName: name,
        generatedAt: Date.now(),
        sounds,
      })
    },

    getStartupAssessment: () => startupAssessment,
    rebuildFromSidecars: () => rebuild.rebuildFromSidecars(),
    subscribeRebuildProgress: (listener) => rebuild.subscribe(listener),

    close: () => {
      controller.dispose()
      staging.close()
      peakService.close()
      rebuild.close()
      auth.close()
      dragRegistry.clear()
      db.close()
    },
  }
}

/** Map a 429 gateway error to the distinct `ThrottledError`; pass anything else through. */
function asTypedError(err: unknown): unknown {
  if (err instanceof GatewayError && err.status === 429) {
    return new ThrottledError(err.retryAfter ?? DEFAULT_RETRY_AFTER_SECONDS)
  }
  return err
}
