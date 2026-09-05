/** Default lifetime of an unclosed in-flight-drag entry. */
export const DRAG_INFLIGHT_TTL_MS = 120_000

/** What eviction needs from the registry: a membership test. */
export interface InFlightDrags {
  /** True while a live Drag-Out still references this Sound's Original. */
  has(soundId: number): boolean
}

export interface DragRegistry extends InFlightDrags {
  /** Mark each Sound as having a Drag-Out in progress (ref-counted). */
  begin(soundIds: Iterable<number>): void
  /** Mark a Drag-Out over for each Sound. Unknown / already-zero ids are ignored. */
  end(soundIds: Iterable<number>): void
  /** Snapshot of Sound ids with at least one live Drag-Out. */
  active(): number[]
  /** Drop every entry and cancel its TTL timer. Called from `core.close()`. */
  clear(): void
}

export function createDragRegistry(
  opts: { ttlMs?: number } = {},
): DragRegistry {
  const ttlMs = opts.ttlMs ?? DRAG_INFLIGHT_TTL_MS
  const counts = new Map<number, number>()
  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  function forget(id: number): void {
    counts.delete(id)
    const t = timers.get(id)
    if (t) {
      clearTimeout(t)
      timers.delete(id)
    }
  }

  return {
    begin(soundIds) {
      for (const id of soundIds) {
        if (typeof id !== 'number' || !Number.isFinite(id)) continue
        counts.set(id, (counts.get(id) ?? 0) + 1)
        const prev = timers.get(id)
        if (prev) clearTimeout(prev)
        const t = setTimeout(() => {
          counts.delete(id)
          timers.delete(id)
        }, ttlMs)
        // Never let this timer hold the process (or a test run) open.
        ;(t as { unref?: () => void }).unref?.()
        timers.set(id, t)
      }
    },
    end(soundIds) {
      for (const id of soundIds) {
        const next = (counts.get(id) ?? 0) - 1
        if (next > 0) counts.set(id, next)
        else forget(id)
      }
    },
    has(soundId) {
      return (counts.get(soundId) ?? 0) > 0
    },
    active() {
      return [...counts.entries()].filter(([, n]) => n > 0).map(([id]) => id)
    },
    clear() {
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
      counts.clear()
    },
  }
}
