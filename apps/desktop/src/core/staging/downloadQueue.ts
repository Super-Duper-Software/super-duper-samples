import type { Scheduler } from '../auth/scheduler'
import { isAbortError } from '../errors'

/** Never more than this many downloads run at once (spec 0001 § Staging). */
export const DOWNLOAD_CONCURRENCY = 3

/** Retry attempts after the first failure, before a sound is marked `failed`. */
export const DOWNLOAD_MAX_RETRIES = 3

/** Backoff before retry N (ms): 1s, 3s, 9s. Uses the injected Scheduler so tests advance it. */
export const DOWNLOAD_RETRY_BACKOFF_MS = [1_000, 3_000, 9_000]

/** Per-sound staging status the renderer shows on each row. */
export type StagingStatus =
  | 'not-started'
  | 'queued'
  | 'downloading'
  | 'ready'
  | 'failed'

export interface DownloadResult {
  bytes: Uint8Array
  contentType: string | null
}

export interface DownloadQueueDeps {
  scheduler: Scheduler
  concurrency?: number
  maxRetries?: number
  backoffMs?: readonly number[]
  /** Perform the actual authenticated download. Rejects with an AbortError on cancel. */
  runDownload: (soundId: number, signal: AbortSignal) => Promise<DownloadResult>
  /** Persist a finished download (write files + DB). Its rejection fails the job. */
  onComplete: (soundId: number, result: DownloadResult) => Promise<void> | void
  /** Called on every status transition (queued → downloading → ready/failed). */
  onStatusChange?: (soundId: number, status: StagingStatus) => void
}

interface Job {
  soundId: number
  status: Extract<StagingStatus, 'queued' | 'downloading' | 'failed'>
  attempts: number
  abort: AbortController
  cancelBackoff: (() => void) | null
}

export interface DownloadQueue {
  /** Enqueue a download. No-op if the sound is already queued/downloading/ready. */
  enqueue(soundId: number): void
  /** Cancel a queued or in-flight download for a sound. No-op if unknown. */
  cancel(soundId: number): void
  /** Current status of a sound in the queue, or `not-started` if it holds no job. */
  status(soundId: number): StagingStatus
  /** Ids the queue currently tracks (queued + downloading + failed). */
  tracked(): number[]
  /** queued + downloading count. */
  readonly size: number
  /** downloading count. */
  readonly active: number
  /** Cancel everything. For `core.close()`. */
  clear(): void
}

export function createDownloadQueue(deps: DownloadQueueDeps): DownloadQueue {
  const concurrency = deps.concurrency ?? DOWNLOAD_CONCURRENCY
  const maxRetries = deps.maxRetries ?? DOWNLOAD_MAX_RETRIES
  const backoff = deps.backoffMs ?? DOWNLOAD_RETRY_BACKOFF_MS

  const jobs = new Map<number, Job>()
  const pending: number[] = []
  let running = 0

  function emit(soundId: number, status: StagingStatus): void {
    deps.onStatusChange?.(soundId, status)
  }

  function enqueue(soundId: number): void {
    const existing = jobs.get(soundId)
    if (existing) {
      if (existing.status === 'failed') {
        drop(soundId)
      } else {
        return
      }
    }
    const job: Job = {
      soundId,
      status: 'queued',
      attempts: 0,
      abort: new AbortController(),
      cancelBackoff: null,
    }
    jobs.set(soundId, job)
    pending.push(soundId)
    emit(soundId, 'queued')
    pump()
  }

  function drop(soundId: number): void {
    const job = jobs.get(soundId)
    if (!job) return
    job.cancelBackoff?.()
    job.abort.abort()
    jobs.delete(soundId)
    const i = pending.indexOf(soundId)
    if (i >= 0) pending.splice(i, 1)
  }

  function cancel(soundId: number): void {
    const job = jobs.get(soundId)
    if (!job) return
    drop(soundId)
    emit(soundId, 'not-started')
  }

  function pump(): void {
    while (running < concurrency && pending.length > 0) {
      const soundId = pending.shift()!
      const job = jobs.get(soundId)
      if (!job) continue
      running += 1
      job.status = 'downloading'
      emit(soundId, 'downloading')
      void runAttempt(job)
    }
  }

  async function runAttempt(job: Job): Promise<void> {
    let releasedSlot = false
    const releaseSlot = (): void => {
      if (!releasedSlot) {
        releasedSlot = true
        running = Math.max(0, running - 1)
      }
    }

    try {
      const result = await deps.runDownload(job.soundId, job.abort.signal)
      if (job.abort.signal.aborted || jobs.get(job.soundId) !== job) return
      await deps.onComplete(job.soundId, result)
      if (jobs.get(job.soundId) !== job) return
      jobs.delete(job.soundId)
      emit(job.soundId, 'ready')
    } catch (err) {
      if (job.abort.signal.aborted || isAbortError(err) || jobs.get(job.soundId) !== job) {
        return
      }
      if (job.attempts < maxRetries) {
        const wait = backoff[Math.min(job.attempts, backoff.length - 1)] ?? 0
        job.attempts += 1
        releaseSlot()
        job.status = 'queued'
        emit(job.soundId, 'queued')
        job.cancelBackoff = deps.scheduler.schedule(() => {
          job.cancelBackoff = null
          if (jobs.get(job.soundId) !== job) return
          pending.push(job.soundId)
          pump()
        }, wait)
        return
      }
      job.status = 'failed'
      emit(job.soundId, 'failed')
    } finally {
      releaseSlot()
      pump()
    }
  }

  return {
    enqueue,
    cancel,
    status(soundId) {
      return jobs.get(soundId)?.status ?? 'not-started'
    },
    tracked() {
      return [...jobs.keys()]
    },
    get size() {
      let n = 0
      for (const j of jobs.values()) if (j.status !== 'failed') n += 1
      return n
    },
    get active() {
      let n = 0
      for (const j of jobs.values()) if (j.status === 'downloading') n += 1
      return n
    },
    clear() {
      for (const id of [...jobs.keys()]) drop(id)
      running = 0
    },
  }
}
