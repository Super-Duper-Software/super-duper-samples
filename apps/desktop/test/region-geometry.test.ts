// Ticket 07 — pure region-select geometry behind the Edit view's waveform:
// building a region from a drag, dragging an edge, nudging an edge, converting
// to seconds, and edge hit-testing. No DOM. Prior art `test/waveform-peaks.test.ts`.

import { describe, expect, it } from 'vitest'
import {
  MIN_REGION_SPAN,
  hitTestEdge,
  moveRegionEdge,
  nudgeRegionEdge,
  regionFromDrag,
  regionToSeconds,
} from '../src/renderer/lib/regionGeometry'

describe('regionFromDrag', () => {
  it('orders start < end regardless of drag direction', () => {
    expect(regionFromDrag(0.2, 0.6)).toEqual({ start: 0.2, end: 0.6 })
    expect(regionFromDrag(0.6, 0.2)).toEqual({ start: 0.2, end: 0.6 })
  })

  it('clamps to [0, 1]', () => {
    expect(regionFromDrag(-0.5, 0.4)).toEqual({ start: 0, end: 0.4 })
    expect(regionFromDrag(0.6, 1.5)).toEqual({ start: 0.6, end: 1 })
  })

  it('never produces a region narrower than MIN_REGION_SPAN', () => {
    const r = regionFromDrag(0.5, 0.5)
    expect(r.end - r.start).toBeCloseTo(MIN_REGION_SPAN)
  })

  it('holds the floor even right at the file end', () => {
    const r = regionFromDrag(1, 1)
    expect(r.end).toBe(1)
    expect(r.end - r.start).toBeCloseTo(MIN_REGION_SPAN)
  })
})

describe('moveRegionEdge', () => {
  const region = { start: 0.3, end: 0.7 }

  it('moves the start edge', () => {
    expect(moveRegionEdge(region, 'start', 0.1)).toEqual({ start: 0.1, end: 0.7 })
  })

  it('moves the end edge', () => {
    expect(moveRegionEdge(region, 'end', 0.9)).toEqual({ start: 0.3, end: 0.9 })
  })

  it('never lets the start edge cross the end edge', () => {
    const r = moveRegionEdge(region, 'start', 0.9)
    expect(r.start).toBeLessThan(r.end)
    expect(r.end - r.start).toBeCloseTo(MIN_REGION_SPAN)
  })

  it('never lets the end edge cross the start edge', () => {
    const r = moveRegionEdge(region, 'end', 0.1)
    expect(r.start).toBeLessThan(r.end)
    expect(r.end - r.start).toBeCloseTo(MIN_REGION_SPAN)
  })

  it('clamps to [0, 1]', () => {
    expect(moveRegionEdge(region, 'start', -1).start).toBe(0)
    expect(moveRegionEdge(region, 'end', 2).end).toBe(1)
  })
})

describe('nudgeRegionEdge', () => {
  it('steps an edge by a delta', () => {
    const region = { start: 0.3, end: 0.7 }
    const start = nudgeRegionEdge(region, 'start', 0.05)
    expect(start.start).toBeCloseTo(0.35)
    expect(start.end).toBe(0.7)
    const end = nudgeRegionEdge(region, 'end', -0.05)
    expect(end.start).toBe(0.3)
    expect(end.end).toBeCloseTo(0.65)
  })

  it('a negative nudge cannot invert the region', () => {
    const region = { start: 0.3, end: 0.31 }
    const r = nudgeRegionEdge(region, 'end', -1)
    expect(r.start).toBeLessThan(r.end)
  })
})

describe('regionToSeconds', () => {
  it('scales a fractional region by the file duration', () => {
    expect(regionToSeconds({ start: 0.25, end: 0.75 }, 10)).toEqual({
      startSec: 2.5,
      endSec: 7.5,
      durationSec: 5,
    })
  })

  it('never reports a negative duration', () => {
    const { durationSec } = regionToSeconds({ start: 0.5, end: 0.5 }, 10)
    expect(durationSec).toBeGreaterThanOrEqual(0)
  })
})

describe('hitTestEdge', () => {
  const region = { start: 0.3, end: 0.7 }

  it('hits the start edge within the radius', () => {
    expect(hitTestEdge(region, 0.31, 0.02)).toBe('start')
  })

  it('hits the end edge within the radius', () => {
    expect(hitTestEdge(region, 0.69, 0.02)).toBe('end')
  })

  it('misses inside the region body', () => {
    expect(hitTestEdge(region, 0.5, 0.02)).toBeNull()
  })

  it('misses outside the region', () => {
    expect(hitTestEdge(region, 0.9, 0.02)).toBeNull()
  })

  it('prefers the start edge when both edges are within radius of a tiny region', () => {
    expect(hitTestEdge({ start: 0.5, end: 0.505 }, 0.5, 0.02)).toBe('start')
  })
})
