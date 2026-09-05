export interface Region {
  start: number
  end: number
}

/** Smallest region span (fraction of file) a drag/nudge can produce — never a zero-width region. */
export const MIN_REGION_SPAN = 0.002

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

/**
 * Build a region from a drag's anchor point and current pointer fraction (both
 * 0..1 of the WHOLE file — the caller un-zooms via `pointerToFraction` first).
 * Order-independent: dragging right-to-left or left-to-right both work.
 */
export function regionFromDrag(anchor: number, current: number): Region {
  const a = clamp01(anchor)
  const b = clamp01(current)
  let start = Math.min(a, b)
  let end = Math.max(a, b)
  if (end - start < MIN_REGION_SPAN) {
    end = Math.min(1, start + MIN_REGION_SPAN)
    if (end - start < MIN_REGION_SPAN) start = Math.max(0, end - MIN_REGION_SPAN)
  }
  return { start, end }
}

/**
 * Drag one edge of an existing region to a new fraction. The edge cannot cross
 * the other edge — it stops `MIN_REGION_SPAN` short, so the region never
 * inverts or collapses under a fast drag.
 */
export function moveRegionEdge(
  region: Region,
  edge: 'start' | 'end',
  fraction: number,
): Region {
  const f = clamp01(fraction)
  if (edge === 'start') {
    const start = Math.min(f, region.end - MIN_REGION_SPAN)
    return { start: Math.max(0, start), end: region.end }
  }
  const end = Math.max(f, region.start + MIN_REGION_SPAN)
  return { start: region.start, end: Math.min(1, end) }
}

/**
 * Nudge one edge by a fixed fraction step (e.g. a keyboard arrow), clamped the
 * same way a drag is.
 */
export function nudgeRegionEdge(
  region: Region,
  edge: 'start' | 'end',
  deltaFraction: number,
): Region {
  return moveRegionEdge(region, edge, region[edge] + deltaFraction)
}

/** A region's start/end/duration in seconds, given the file's total duration. */
export function regionToSeconds(
  region: Region,
  durationSec: number,
): { startSec: number; endSec: number; durationSec: number } {
  const startSec = region.start * durationSec
  const endSec = region.end * durationSec
  return { startSec, endSec, durationSec: Math.max(0, endSec - startSec) }
}

/**
 * Which edge (if either) a pointer at `fraction` is close enough to grab, given
 * a per-pixel hit radius already converted to a fraction of the box width.
 * Returns `null` when the pointer is inside the region body (a plain drag would
 * redraw a new region) or outside it.
 */
export function hitTestEdge(
  region: Region,
  fraction: number,
  hitRadiusFraction: number,
): 'start' | 'end' | null {
  if (Math.abs(fraction - region.start) <= hitRadiusFraction) return 'start'
  if (Math.abs(fraction - region.end) <= hitRadiusFraction) return 'end'
  return null
}
