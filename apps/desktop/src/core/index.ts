// The core: a plain Node module holding ALL behaviour. NO `electron` import may
// ever appear anywhere under src/core/ (enforced by test/core.no-electron.test.ts).
//
// `createCore` returns an object whose methods ARE the command API. The
// contextBridge preload surface forwards those methods verbatim — the core's
// command API *is* the IPC contract (CONVENTIONS.md, spec 0001).

import { mapRawSound } from './gateway/mapRawSound'
import type { FreesoundGateway, RawSearchPage } from './gateway/index'
import type { SearchOptions, SearchResult } from './types'
import {
  DEFAULT_RETRY_AFTER_SECONDS,
  GatewayError,
  ThrottledError,
} from './errors'
import { openDb, type DB } from './db/index'
import { getSoundsByIds, upsertSounds } from './db/sounds'
import {
  cacheKey,
  readSearchCache,
  writeSearchCache,
  type SearchCacheParams,
} from './db/searchCache'
import { createSearchController, type SearchController } from './searchController'
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

const DEFAULT_PAGE_SIZE = 15
const DEBOUNCE_MS = 250

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

  const staging: StagingController = createStagingController({
    db,
    dataDir: deps.dataDir,
    gateway,
    auth,
    scheduler,
    onStatusChange: deps.onStagingStatusChange,
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
    ck: ReturnType<typeof cacheKey>,
    allowPrefetch: boolean,
  ): Promise<SearchResult> {
    let raw: RawSearchPage
    try {
      raw = await gateway.search({ query: query.trim(), page, pageSize })
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

    if (allowPrefetch && hasMore) prefetchNextPage(query, page, pageSize)

    return { query, totalCount: raw.count, page, pageSize, sounds, hasMore }
  }

  function runSearch(
    query: string,
    opts: SearchOptions | undefined,
    allowPrefetch: boolean,
  ): Promise<SearchResult> {
    const page = opts?.page ?? 1
    const pageSize = opts?.pageSize ?? DEFAULT_PAGE_SIZE
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

    const params: SearchCacheParams = { query: trimmed, page, pageSize }
    const ck = cacheKey(params)

    const cached = readSearchCache(db, ck.key)
    if (cached) return Promise.resolve(fromCache(query, page, pageSize, cached))

    const existing = inFlight.get(ck.key)
    if (existing) return existing

    const p = fetchAndStore(query, page, pageSize, ck, allowPrefetch).finally(
      () => {
        inFlight.delete(ck.key)
      },
    )
    inFlight.set(ck.key, p)
    return p
  }

  function prefetchNextPage(
    query: string,
    page: number,
    pageSize: number,
  ): void {
    const nextParams: SearchCacheParams = {
      query: query.trim(),
      page: page + 1,
      pageSize,
    }
    const { key } = cacheKey(nextParams)
    if (inFlight.has(key) || readSearchCache(db, key)) return
    // Fire-and-forget; errors are swallowed. `allowPrefetch: false` so prefetch
    // never chains into prefetching page+2, page+3, …
    void runSearch(query, { page: page + 1, pageSize }, false).catch(() => {})
  }

  const controller: SearchController = createSearchController(
    { search: (q, o) => runSearch(q, o, true) },
    { debounceMs },
  )

  return {
    search: (query, opts) => runSearch(query, opts, true),
    searchDebounced: (query, opts) => controller.query(query, opts),
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
    close: () => {
      controller.dispose()
      staging.close()
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
