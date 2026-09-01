// Ticket 01 — the breakpoint seam. `layoutForWidth` is the single pure helper
// the whole responsive shell branches on; the boundary between "rail" and "wide"
// is the one thing that must be exact. The `useViewport` hook is a `matchMedia`
// wrapper and is verified manually (spec 0003 § Testing Decisions). No DOM here.
// Prior art: `test/region-geometry.test.ts`.

import { describe, expect, it } from 'vitest'
import { RAIL_MAX_WIDTH, layoutForWidth } from '../src/renderer/lib/viewport'

describe('layoutForWidth', () => {
  it('pins the breakpoint at 760', () => {
    expect(RAIL_MAX_WIDTH).toBe(760)
  })

  it('is exact at the 760/761 boundary', () => {
    expect(layoutForWidth(759)).toBe('rail')
    expect(layoutForWidth(760)).toBe('rail')
    expect(layoutForWidth(761)).toBe('wide')
    expect(layoutForWidth(762)).toBe('wide')
  })

  it('resolves rail across the narrow range down to the window floor', () => {
    expect(layoutForWidth(0)).toBe('rail')
    expect(layoutForWidth(360)).toBe('rail')
    expect(layoutForWidth(700)).toBe('rail')
  })

  it('resolves wide across the range above the breakpoint', () => {
    expect(layoutForWidth(900)).toBe('wide')
    expect(layoutForWidth(1440)).toBe('wide')
    expect(layoutForWidth(Number.MAX_SAFE_INTEGER)).toBe('wide')
  })
})
