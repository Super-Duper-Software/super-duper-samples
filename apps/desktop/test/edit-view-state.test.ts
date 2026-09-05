// Ticket 20 — the Edit view's waveform-state decision, isolated from React.
//
// Spec 0001 keeps renderer *component* tests out; the one thing worth pinning
// here is that `EditView` can now tell "still computing" (`peaks === undefined`)
// apart from "resolved, and no waveform is coming" (`peaks === null`) — the bug
// was a FLAC Original stuck on "Computing the waveform…" forever because those
// two collapsed into one branch. `waveformDisplayState` is that branch, pulled
// into a pure function.

import { describe, expect, it } from 'vitest'
import { waveformDisplayState } from '../src/renderer/lib/editViewState'
import type { PeaksPayload } from '../src/core/peaks/peakService'

const payload: PeaksPayload = { sampleRate: 8000, bucketCount: 128, peaks: [] }

describe('waveformDisplayState', () => {
  it('"Original not on disk" (contentPath null) wins over any peaks value', () => {
    expect(waveformDisplayState(undefined, null)).toBe('no-original')
    expect(waveformDisplayState(null, null)).toBe('no-original')
    expect(waveformDisplayState(payload, null)).toBe('no-original')
  })

  it('peaks undefined → still computing', () => {
    expect(waveformDisplayState(undefined, '/x.flac')).toBe('computing')
  })

  it('content path still resolving → still computing (no error flash)', () => {
    expect(waveformDisplayState(payload, undefined)).toBe('computing')
  })

  it('peaks resolved to null → unavailable, a real error state (never a perpetual spinner)', () => {
    expect(waveformDisplayState(null, '/x.flac')).toBe('unavailable')
  })

  it('an empty sentinel payload is also unavailable', () => {
    expect(waveformDisplayState({ ...payload, bucketCount: 0 }, '/x.flac')).toBe(
      'unavailable',
    )
  })

  it('a real payload → ready (draw the canvas)', () => {
    expect(waveformDisplayState(payload, '/x.flac')).toBe('ready')
  })
})
