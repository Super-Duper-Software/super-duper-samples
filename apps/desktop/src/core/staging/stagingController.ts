import type { DB } from '../db/index'
import { getMeta, setMeta, STAGING_CONSENT_KEY } from '../db/appMeta'
import { getSoundsByIds, upsertSound } from '../db/sounds'
import {
  hasLibraryEntry,
  hasStagedEntry,
  touchStagedEntry,
  upsertStagedEntry,
} from '../db/staged'
import { saveLibraryEntry } from '../db/library'
import {
  countDownloadsSince,
  recordDownload,
  DOWNLOAD_QUOTA_WINDOW_MS,
} from '../db/downloads'
import type { Scheduler } from '../auth/scheduler'
import type { AuthController } from '../auth/authController'
import type { FreesoundGateway } from '../gateway/index'
import type { Sound } from '../types'
import { isOriginalOnDisk, writeOriginal } from './contentStore'
import {
  clearStaged as clearStagedFiles,
  computeDiskUsage,
  evictStagedOverBudget,
  type DiskUsage,
  type EvictionOutcome,
} from './eviction'
import type { InFlightDrags } from './dragRegistry'
import {
  createDownloadQueue,
  type DownloadQueue,
  type StagingStatus,
} from './downloadQueue'

export type { StagingStatus } from './downloadQueue'
export {
  DOWNLOAD_CONCURRENCY,
  DOWNLOAD_MAX_RETRIES,
  DOWNLOAD_RETRY_BACKOFF_MS,
} from './downloadQueue'

export interface StagingConsent {
  /** Epoch ms the user acknowledged the notice, or `null` if not yet. */
  grantedAt: number | null
}

export interface StagingStatusChange {
  soundId: number
  status: StagingStatus
}

export interface StagingController {
  /**
   * Enqueue the Original for background download, having first cancelled the
   * previous audition's unfinished, unsaved download. Fire-and-forget.
   *
   * Silent no-op when signed out, before consent, for an unknown Sound, or when
   * the Original is already on disk (which just bumps `last_access_at`).
   */
  stageOnAudition(soundId: number): void
  /**
   * Explicit download that also saves the Sound to the Library once the bytes
   * land, and records it against the rolling quota. Needs no staging consent —
   * the click IS the consent — and never cancel-on-skips.
   *
   * Silent no-op when signed out or the Sound is unknown. An Original already on
   * disk is just promoted to the Library.
   */
  downloadToLibrary(soundId: number, sound?: Sound): void
  cancelStaging(soundId: number): void
  /** Originals downloaded in the last rolling 24 h (Freesound caps this at 2,000). */
  getDownloadsInLast24h(): number
  getStagingStatus(ids: number[]): Record<number, StagingStatus>
  /** Whether the first-run notice has been acknowledged. */
  getStagingConsent(): StagingConsent
  /** Record that the user acknowledged the first-run notice. Idempotent. */
  grantStagingConsent(): StagingConsent
  subscribe(listener: (change: StagingStatusChange) => void): () => void
  /** On-disk footprint, split between Staged and Library bytes. */
  getDiskUsage(): Promise<DiskUsage>
  /**
   * Remove every Staged Original + sidecar + row, leaving the Library untouched
   * and skipping any Sound with a live Drag-Out.
   */
  clearStaged(): Promise<EvictionOutcome>
  /** Test/introspection: the underlying queue. */
  readonly queue: DownloadQueue
  close(): void
}

export interface StagingControllerDeps {
  db: DB
  dataDir: string
  gateway: Pick<FreesoundGateway, 'downloadOriginal'>
  auth: Pick<AuthController, 'getState' | 'authorized'>
  scheduler: Scheduler
  onStatusChange?: (change: StagingStatusChange) => void
  /** A download gave up for good (retries exhausted). The core classifies `err` for telemetry. */
  onDownloadFailed?: (soundId: number, err: unknown) => void
  /** A Sound's Original has just landed on disk; the core wires this to peak computation. */
  onOriginalReady?: (soundId: number) => void
  /** Exceeding it after a stage triggers an LRU eviction. See `DEFAULT_STAGING_BYTE_BUDGET`. */
  byteBudget: number
  /** Eviction and `clearStaged` skip any Sound this reports as having a live Drag-Out. */
  inFlightDrags: InFlightDrags
  /** Test seams. */
  concurrency?: number
  maxRetries?: number
  backoffMs?: readonly number[]
}

export function createStagingController(
  deps: StagingControllerDeps,
): StagingController {
  const { db, dataDir, gateway, auth, scheduler } = deps
  const listeners = new Set<(c: StagingStatusChange) => void>()

  /** The sound whose download is currently the "live" audition (cancel-on-skip). */
  let activeAuditionId: number | null = null

  /** Downloads that go straight into the Library on completion, not into Staged. */
  const libraryBound = new Set<number>()

  function emit(change: StagingStatusChange): void {
    for (const l of listeners) l(change)
    deps.onStatusChange?.(change)
  }

  function soundById(soundId: number): Sound | undefined {
    return getSoundsByIds(db, [soundId])[0]
  }

  const queue = createDownloadQueue({
    scheduler,
    concurrency: deps.concurrency,
    maxRetries: deps.maxRetries,
    backoffMs: deps.backoffMs,
    runDownload: (soundId, signal) =>
      auth.authorized((accessToken) =>
        gateway.downloadOriginal(soundId, accessToken, { signal }),
      ),
    onComplete: async (soundId, result) => {
      const sound = soundById(soundId)
      if (!sound)
        throw new Error(`staging: sound ${soundId} vanished from the DB`)
      const now = Date.now()
      const { byteSize, paths } = await writeOriginal(
        dataDir,
        sound,
        result.bytes,
        now,
      )
      upsertSound(db, sound)
      recordDownload(db, soundId, now)
      if (libraryBound.has(soundId)) {
        libraryBound.delete(soundId)
        saveLibraryEntry(db, soundId, now)
      } else {
        upsertStagedEntry(db, { soundId, byteSize, path: paths.original, now })
        scheduleEviction()
      }
      try {
        deps.onOriginalReady?.(soundId)
      } catch {
        /* peak scheduling is best-effort */
      }
    },
    onStatusChange: (soundId, status) => emit({ soundId, status }),
    onFailed: (soundId, err) => deps.onDownloadFailed?.(soundId, err),
  })

  let evictionScheduled = false
  function scheduleEviction(): void {
    if (evictionScheduled) return
    evictionScheduled = true
    setImmediate(() => {
      evictionScheduled = false
      void evictStagedOverBudget(
        db,
        dataDir,
        deps.byteBudget,
        deps.inFlightDrags,
      ).catch(() => {})
    })
  }

  function getDiskUsage(): Promise<DiskUsage> {
    return computeDiskUsage(db, dataDir)
  }

  function clearStaged(): Promise<EvictionOutcome> {
    return clearStagedFiles(db, dataDir, deps.inFlightDrags)
  }

  function isReadyOnDisk(soundId: number, sound?: Sound): boolean {
    if (hasStagedEntry(db, soundId) || hasLibraryEntry(db, soundId)) return true
    return sound ? isOriginalOnDisk(dataDir, sound) : false
  }

  function stageOnAudition(soundId: number): void {
    if (auth.getState().status !== 'signedIn') return
    if (getStagingConsent().grantedAt == null) return

    const sound = soundById(soundId)
    if (!sound) return

    if (
      activeAuditionId != null &&
      activeAuditionId !== soundId &&
      !isReadyOnDisk(activeAuditionId) &&
      !hasLibraryEntry(db, activeAuditionId)
    ) {
      queue.cancel(activeAuditionId)
    }
    activeAuditionId = soundId

    if (isReadyOnDisk(soundId, sound)) {
      touchStagedEntry(db, soundId, Date.now())
      emit({ soundId, status: 'ready' })
      return
    }

    queue.enqueue(soundId)
  }

  function cancelStaging(soundId: number): void {
    if (activeAuditionId === soundId) activeAuditionId = null
    libraryBound.delete(soundId)
    queue.cancel(soundId)
  }

  function downloadToLibrary(soundId: number, sound?: Sound): void {
    if (auth.getState().status !== 'signedIn') return

    if (sound) upsertSound(db, sound)
    const known = sound ?? soundById(soundId)
    if (!known) return

    if (isReadyOnDisk(soundId, known)) {
      if (!hasLibraryEntry(db, soundId)) {
        saveLibraryEntry(db, soundId, Date.now())
      }
      emit({ soundId, status: 'ready' })
      return
    }

    libraryBound.add(soundId)
    queue.enqueue(soundId)
  }

  function getDownloadsInLast24h(): number {
    return countDownloadsSince(db, Date.now() - DOWNLOAD_QUOTA_WINDOW_MS)
  }

  function statusOf(soundId: number): StagingStatus {
    if (hasLibraryEntry(db, soundId) || hasStagedEntry(db, soundId))
      return 'ready'
    return queue.status(soundId)
  }

  function getStagingStatus(ids: number[]): Record<number, StagingStatus> {
    const out: Record<number, StagingStatus> = {}
    for (const id of ids) out[id] = statusOf(id)
    return out
  }

  function getStagingConsent(): StagingConsent {
    const raw = getMeta(db, STAGING_CONSENT_KEY)
    const n = raw == null ? null : Number(raw)
    return { grantedAt: n != null && Number.isFinite(n) ? n : null }
  }

  function grantStagingConsent(): StagingConsent {
    if (getMeta(db, STAGING_CONSENT_KEY) == null) {
      setMeta(db, STAGING_CONSENT_KEY, String(Date.now()))
    }
    return getStagingConsent()
  }

  return {
    stageOnAudition,
    downloadToLibrary,
    getDownloadsInLast24h,
    cancelStaging,
    getStagingStatus,
    getStagingConsent,
    grantStagingConsent,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getDiskUsage,
    clearStaged,
    queue,
    close() {
      queue.clear()
      listeners.clear()
    },
  }
}
