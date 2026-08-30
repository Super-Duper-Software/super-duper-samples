// Staging orchestration (ticket 08). Ties the download queue to SQLite, the
// content store, the auth layer and the first-run consent gate, and exposes the
// four commands the renderer calls plus a status query and a change event.
//
// Cancel-on-skip design (one of the two the ticket offers — this is "the
// simplest robust" one): the renderer calls `stageOnAudition(id)` on every play.
// The core remembers the previous audition and, when a new one arrives, cancels
// the previous download IF it has not finished (still queued/downloading) AND
// was not saved to the Library. So walking a result list by ear never leaves
// more than one speculative download alive; only sounds the user lingered on
// long enough to finish downloading stay Staged.

import type { DB } from '../db/index'
import { getMeta, setMeta, STAGING_CONSENT_KEY } from '../db/appMeta'
import { getSoundsByIds, upsertSound } from '../db/sounds'
import {
  hasLibraryEntry,
  hasStagedEntry,
  touchStagedEntry,
  upsertStagedEntry,
} from '../db/staged'
import type { Scheduler } from '../auth/scheduler'
import type { AuthController } from '../auth/authController'
import type { FreesoundGateway } from '../gateway/index'
import type { Sound } from '../types'
import { isOriginalOnDisk, writeOriginal } from './contentStore'
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
   * Called by the renderer's audition flow. Fire-and-forget. Streams nothing
   * itself — it enqueues the Original for background download, having first
   * cancelled the previous audition's unfinished, unsaved download.
   *
   * Silent no-op when: signed out, consent not yet granted, the Sound is unknown
   * to the DB, or the Original is already on disk (in which case it just bumps
   * `last_access_at`).
   */
  stageOnAudition(soundId: number): void
  /** Explicitly cancel a sound's in-flight/queued staging (renderer calls this on Stop). */
  cancelStaging(soundId: number): void
  /** Per-sound staging status for the row indicators. */
  getStagingStatus(ids: number[]): Record<number, StagingStatus>
  /** Whether the first-run notice has been acknowledged. */
  getStagingConsent(): StagingConsent
  /** Record that the user acknowledged the first-run notice. Idempotent. */
  grantStagingConsent(): StagingConsent
  /** Subscribe to status transitions. Returns an unsubscribe fn. */
  subscribe(listener: (change: StagingStatusChange) => void): () => void
  /** Test/introspection: the underlying queue. */
  readonly queue: DownloadQueue
  /** Cancel everything. Called from `core.close()`. */
  close(): void
}

export interface StagingControllerDeps {
  db: DB
  dataDir: string
  gateway: Pick<FreesoundGateway, 'downloadOriginal'>
  auth: Pick<AuthController, 'getState' | 'authorized'>
  scheduler: Scheduler
  /** Broadcast every status change (main forwards it to the renderer). */
  onStatusChange?: (change: StagingStatusChange) => void
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
      if (!sound) throw new Error(`staging: sound ${soundId} vanished from the DB`)
      const now = Date.now()
      const { byteSize, paths } = await writeOriginal(
        dataDir,
        sound,
        result.bytes,
        now,
      )
      // Keep a `sounds` row (it should already exist) and record the staged state
      // ticket 10 evicts against.
      upsertSound(db, sound)
      upsertStagedEntry(db, { soundId, byteSize, path: paths.original, now })
    },
    onStatusChange: (soundId, status) => emit({ soundId, status }),
  })

  function isReadyOnDisk(soundId: number, sound?: Sound): boolean {
    if (hasStagedEntry(db, soundId) || hasLibraryEntry(db, soundId)) return true
    return sound ? isOriginalOnDisk(dataDir, sound) : false
  }

  function stageOnAudition(soundId: number): void {
    // 1. Signed-in only.
    if (auth.getState().status !== 'signedIn') return
    // 2. First-run consent.
    if (getStagingConsent().grantedAt == null) return

    const sound = soundById(soundId)
    if (!sound) return // unknown Sound — nothing to download

    // 3. Cancel the previous audition's download unless it finished or was saved.
    if (
      activeAuditionId != null &&
      activeAuditionId !== soundId &&
      !isReadyOnDisk(activeAuditionId) &&
      !hasLibraryEntry(db, activeAuditionId)
    ) {
      queue.cancel(activeAuditionId)
    }
    activeAuditionId = soundId

    // 4. Already on disk → just refresh last-accessed and report ready.
    if (isReadyOnDisk(soundId, sound)) {
      touchStagedEntry(db, soundId, Date.now())
      emit({ soundId, status: 'ready' })
      return
    }

    // 5. Enqueue the background download.
    queue.enqueue(soundId)
  }

  function cancelStaging(soundId: number): void {
    if (activeAuditionId === soundId) activeAuditionId = null
    queue.cancel(soundId)
  }

  function statusOf(soundId: number): StagingStatus {
    if (hasLibraryEntry(db, soundId) || hasStagedEntry(db, soundId)) return 'ready'
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
    cancelStaging,
    getStagingStatus,
    getStagingConsent,
    grantStagingConsent,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    queue,
    close() {
      queue.clear()
      listeners.clear()
    },
  }
}
