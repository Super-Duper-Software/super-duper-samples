import { useSyncExternalStore } from 'react'

/**
 * The one flip point. A viewport at or below this CSS width is "rail"; strictly
 * above it is "wide". Import it rather than repeating the number, so any Tailwind
 * `max-[...]` tweak stays in step with the JS branch.
 */
export const RAIL_MAX_WIDTH = 760

export type Layout = 'wide' | 'rail'

/** Pure — the single seam layout branches on. */
export function layoutForWidth(width: number): Layout {
  return width <= RAIL_MAX_WIDTH ? 'rail' : 'wide'
}

const RAIL_MEDIA_QUERY = `(max-width: ${RAIL_MAX_WIDTH}px)`

let mql: MediaQueryList | null = null
let started = false
const subscribers = new Set<() => void>()

function broadcast(): void {
  for (const notify of subscribers) notify()
}

function ensureListener(): void {
  if (started) return
  started = true
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  mql = window.matchMedia(RAIL_MEDIA_QUERY)
  mql.addEventListener('change', broadcast)
}

function subscribe(notify: () => void): () => void {
  ensureListener()
  subscribers.add(notify)
  return () => {
    subscribers.delete(notify)
  }
}

function isRailSnapshot(): boolean {
  ensureListener()
  return mql ? mql.matches : false
}

export interface Viewport {
  /** `true` when the window is in the thin "rail" layout band. */
  isRail: boolean
}

/**
 * Live viewport layout for the renderer. Reads its initial value synchronously
 * (via `useSyncExternalStore`), so the first paint is already in the correct
 * layout — no wide→rail flash when launching into a narrow window — and drops
 * its subscription on unmount.
 */
export function useViewport(): Viewport {
  const isRail = useSyncExternalStore(subscribe, isRailSnapshot, () => false)
  return { isRail }
}
