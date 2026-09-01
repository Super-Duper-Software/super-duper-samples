// Ticket 02 — `resolveTrim` (pure). Clamps a trim window to the source's own
// duration and rejects an empty region up front, before any render starts.

import { describe, expect, it } from 'vitest'
import { InvalidTrimError, resolveTrim } from '../src/core'

describe('resolveTrim (pure)', () => {
  it('passes null through unchanged (whole file)', () => {
    expect(resolveTrim(34.7, null)).toBeNull()
  })

  it('leaves a trim inside the source untouched', () => {
    expect(resolveTrim(34.7, { startSec: 2, endSec: 7 })).toEqual({
      startSec: 2,
      endSec: 7,
    })
  })

  it('clamps a start/end that overruns the source duration', () => {
    expect(resolveTrim(10, { startSec: -5, endSec: 1000 })).toEqual({
      startSec: 0,
      endSec: 10,
    })
  })

  it('throws InvalidTrimError when the clamped region is zero-length or inverted', () => {
    expect(() => resolveTrim(10, { startSec: 12, endSec: 20 })).toThrow(InvalidTrimError)
    expect(() => resolveTrim(10, { startSec: 5, endSec: 5 })).toThrow(InvalidTrimError)
    expect(() => resolveTrim(10, { startSec: 8, endSec: 3 })).toThrow(InvalidTrimError)
  })
})
