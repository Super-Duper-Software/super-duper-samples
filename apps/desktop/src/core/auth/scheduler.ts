// The timer seam. Proactive-refresh scheduling and the sign-in timeout both go
// through this so tests can advance time deterministically instead of waiting
// real seconds. Production wraps `setTimeout` / `Date.now`; tests inject a fake
// that fires due callbacks on demand.

export interface Scheduler {
  /**
   * Run `fn` once after `ms` milliseconds. Returns a cancel function; calling it
   * before `fn` runs guarantees `fn` never runs. `ms` may be 0 (or negative,
   * treated as 0) for "as soon as possible".
   */
  schedule(fn: () => void, ms: number): () => void

  /** Current time in epoch milliseconds. The fake advances this itself. */
  now(): number
}

/** Production scheduler: real `setTimeout` and wall-clock time. */
export function createRealScheduler(): Scheduler {
  return {
    schedule(fn, ms) {
      const timer = setTimeout(fn, Math.max(0, ms))
      // Do not keep the process alive purely for a pending refresh.
      if (typeof timer === 'object' && timer && 'unref' in timer) {
        ;(timer as { unref: () => void }).unref()
      }
      return () => clearTimeout(timer)
    },
    now: () => Date.now(),
  }
}
