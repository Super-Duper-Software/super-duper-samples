import type { Scheduler } from '../../src/core/auth/scheduler'

interface Task {
  id: number
  at: number
  fn: () => void
  cancelled: boolean
}

export class FakeScheduler implements Scheduler {
  #now: number
  #seq = 1
  #tasks: Task[] = []

  constructor(startMs = 1_700_000_000_000) {
    this.#now = startMs
  }

  now(): number {
    return this.#now
  }

  schedule(fn: () => void, ms: number): () => void {
    const task: Task = {
      id: this.#seq++,
      at: this.#now + Math.max(0, ms),
      fn,
      cancelled: false,
    }
    this.#tasks.push(task)
    return () => {
      task.cancelled = true
    }
  }

  /** Number of live (not-yet-fired, not-cancelled) tasks. */
  get pending(): number {
    return this.#tasks.filter((t) => !t.cancelled).length
  }

  /**
   * Move the clock forward `ms`, firing every task that becomes due, in time
   * order. Yields to the microtask/macrotask queue after each callback so the
   * async chains they kick off (refresh -> persist -> reschedule) settle.
   */
  async advance(ms: number): Promise<void> {
    const target = this.#now + ms
    for (;;) {
      const due = this.#tasks
        .filter((t) => !t.cancelled && t.at <= target)
        .sort((a, b) => a.at - b.at)[0]
      if (!due) break
      this.#tasks = this.#tasks.filter((t) => t !== due)
      this.#now = Math.max(this.#now, due.at)
      due.fn()
      await new Promise((r) => setImmediate(r))
    }
    this.#now = target
    await new Promise((r) => setImmediate(r))
  }
}
