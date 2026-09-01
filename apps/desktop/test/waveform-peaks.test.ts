// Ticket 12 — the pure client-side math behind the canvas waveform: resampling
// the fixed base envelope to any pixel width / zoom window, mapping a pointer to
// a seek fraction while zoomed, and stepping the zoom window. No DOM.

import { describe, expect, it } from 'vitest'
import {
  panWindow,
  pointerToFraction,
  resamplePeaks,
  zoomWindow,
} from '../src/renderer/lib/waveformPeaks'

/** 10 buckets: bucket b has min = -b/10, max = +b/10. */
const env = {
  bucketCount: 10,
  peaks: Array.from({ length: 10 }, (_, b) => [-(b / 10), b / 10]).flat(),
}

describe('resamplePeaks', () => {
  it('produces exactly `columns` pairs at any width', () => {
    expect(resamplePeaks(env, 3)).toHaveLength(3)
    expect(resamplePeaks(env, 200)).toHaveLength(200)
    expect(resamplePeaks(env, 1)).toHaveLength(1)
  })

  it('a narrow width aggregates the extreme across every bucket a column spans', () => {
    // One column over the whole file → the global min/max (bucket 9).
    const [only] = resamplePeaks(env, 1)
    expect(only!.min).toBeCloseTo(-0.9)
    expect(only!.max).toBeCloseTo(0.9)
  })

  it('a zoom window only draws the buckets inside it, at full column resolution', () => {
    // Zoom to the last 20% of the file — buckets 8 and 9.
    const cols = resamplePeaks(env, 2, 0.8, 1)
    expect(cols).toHaveLength(2)
    expect(cols[1]!.max).toBeCloseTo(0.9)
    expect(cols[0]!.max).toBeGreaterThan(0.7) // bucket 8-ish, louder than the file average
  })

  it('is stable when asked for more columns than base buckets (blocky, not gappy)', () => {
    const cols = resamplePeaks(env, 40, 0, 1)
    expect(cols).toHaveLength(40)
    for (const c of cols) {
      expect(Number.isFinite(c.min)).toBe(true)
      expect(Number.isFinite(c.max)).toBe(true)
      expect(c.max).toBeGreaterThanOrEqual(c.min)
    }
  })
})

describe('pointerToFraction — seek stays accurate while zoomed', () => {
  it('maps 1:1 with no zoom', () => {
    expect(pointerToFraction(0, 0, 1)).toBe(0)
    expect(pointerToFraction(0.5, 0, 1)).toBeCloseTo(0.5)
    expect(pointerToFraction(1, 0, 1)).toBe(1)
  })

  it('maps into the visible window when zoomed', () => {
    // Window covers 0.6..0.8 of the file; the middle of the view is 0.7.
    expect(pointerToFraction(0.5, 0.6, 0.8)).toBeCloseTo(0.7)
    expect(pointerToFraction(0, 0.6, 0.8)).toBeCloseTo(0.6)
    expect(pointerToFraction(1, 0.6, 0.8)).toBeCloseTo(0.8)
  })

  it('clamps out-of-box pointers', () => {
    expect(pointerToFraction(-0.3, 0.6, 0.8)).toBeCloseTo(0.6)
    expect(pointerToFraction(2, 0.6, 0.8)).toBeCloseTo(0.8)
  })
})

describe('zoomWindow', () => {
  it('zooms in toward the focus point and stays within [0,1]', () => {
    const z = zoomWindow(0, 1, 0.5, 0.5)
    expect(z.end - z.start).toBeCloseTo(0.5)
    expect(z.start).toBeCloseTo(0.25)
    expect(z.end).toBeCloseTo(0.75)
  })

  it('never exceeds the full file when zooming out', () => {
    const z = zoomWindow(0.4, 0.6, 10, 0.5)
    expect(z.start).toBe(0)
    expect(z.end).toBe(1)
  })

  it('honours a minimum span', () => {
    const z = zoomWindow(0, 1, 0.0001, 0.5, 0.02)
    expect(z.end - z.start).toBeCloseTo(0.02)
  })

  it('keeps the window pinned to an edge when the focus is at the edge', () => {
    const z = zoomWindow(0, 1, 0.5, 0)
    expect(z.start).toBe(0)
    expect(z.end).toBeCloseTo(0.5)
  })
})

describe('panWindow — horizontal scroll while zoomed', () => {
  it('slides the window without changing its span', () => {
    const p = panWindow(0.2, 0.4, 0.1)
    expect(p.start).toBeCloseTo(0.3)
    expect(p.end).toBeCloseTo(0.5)
    expect(p.end - p.start).toBeCloseTo(0.2)
  })

  it('pans backward with a negative delta', () => {
    const p = panWindow(0.4, 0.6, -0.1)
    expect(p.start).toBeCloseTo(0.3)
    expect(p.end).toBeCloseTo(0.5)
  })

  it('clamps at the start of the file, keeping the span', () => {
    const p = panWindow(0.1, 0.3, -0.5)
    expect(p.start).toBe(0)
    expect(p.end).toBeCloseTo(0.2)
  })

  it('clamps at the end of the file, keeping the span', () => {
    const p = panWindow(0.7, 0.9, 0.5)
    expect(p.end).toBe(1)
    expect(p.start).toBeCloseTo(0.8)
  })

  it('is a no-op at full zoom (span already covers the whole file)', () => {
    const p = panWindow(0, 1, 0.3)
    expect(p.start).toBe(0)
    expect(p.end).toBe(1)
  })
})
