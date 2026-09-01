// Ticket 04 — the ONE renderer-state invariant worth a unit test: the moving
// playhead must not be able to re-render list rows.
//
// Rows subscribe to the transport store through `selectRowTransport(id)` +
// `useShallow`. This test asserts, at the state-shape level (no React, no DOM):
//
//   1. the transport store carries NO per-frame field (currentTime / playhead /
//      tick / progress) — the 60fps playhead lives in `audioController`'s rAF
//      loop and is written straight to a DOM node, never into this store;
//   2. the coarse actions a row does NOT care about (volume, loop, seek) leave
//      every row's selector output shallow-equal, so `useShallow` bails the
//      re-render;
//   3. starting a track flips `isCurrent` for exactly the outgoing and incoming
//      rows and nothing else;
//   4. a failed Preview is keyed by sound id and marks only that row.
//
// Per spec 0001 there are no renderer *component* tests; this stays a pure
// state-shape check and does not render anything.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { shallow } from 'zustand/shallow'
import type { Sound } from '../src/core/types'
import { __resetForTest } from '../src/renderer/store/audioController'
import { selectRowTransport, useTransport } from '../src/renderer/store/useTransport'

function fakeSound(id: number, withPreview = true): Sound {
  return {
    id,
    name: `sound ${id}`,
    username: 'tester',
    license: { url: 'http://creativecommons.org/publicdomain/zero/1.0/', name: 'CC0' },
    duration: 3,
    tags: [],
    filesize: 1,
    type: 'wav',
    samplerate: 44100,
    channels: 2,
    bitdepth: 16,
    previewUrls: {
      hqMp3: withPreview ? `https://cdn.freesound.org/previews/${id}-hq.mp3` : '',
      lqMp3: withPreview ? `https://cdn.freesound.org/previews/${id}-lq.mp3` : '',
      hqOgg: '',
      lqOgg: '',
    },
    waveformUrls: { m: 'm.png', l: 'l.png' },
    url: `https://freesound.org/s/${id}/`,
    downloadCount: 0,
    avgRating: 0,
    created: '2020-01-01T00:00:00Z',
  }
}

beforeEach(() => {
  __resetForTest()
  useTransport.setState({
    status: 'idle',
    currentSoundId: null,
    loop: false,
    autoAdvance: false,
    volume: 0.8,
    failedIds: new Set<number>(),
    _advance: null,
  })
})

describe('transport store — playhead cannot re-render rows', () => {
  it('holds no per-frame playback field', () => {
    const keys = Object.keys(useTransport.getState())
    for (const banned of ['currentTime', 'playhead', 'position', 'tick', 'progress', 'frame']) {
      expect(keys).not.toContain(banned)
    }
  })

  it('volume / loop / seek leave every row selector output shallow-equal', () => {
    useTransport.getState().playSound(fakeSound(1))

    const before = selectRowTransport(2)(useTransport.getState())

    useTransport.getState().setVolume(0.1)
    useTransport.getState().setLoop(true)
    useTransport.getState().seekFraction(0.5)

    const after = selectRowTransport(2)(useTransport.getState())
    expect(shallow(before, after)).toBe(true)
  })

  it('starting a track flips isCurrent for exactly the two rows involved', () => {
    useTransport.getState().playSound(fakeSound(1))
    expect(selectRowTransport(1)(useTransport.getState()).isCurrent).toBe(true)
    expect(selectRowTransport(2)(useTransport.getState()).isCurrent).toBe(false)

    const bystanderBefore = selectRowTransport(3)(useTransport.getState())

    useTransport.getState().playSound(fakeSound(2))
    expect(selectRowTransport(1)(useTransport.getState()).isCurrent).toBe(false)
    expect(selectRowTransport(2)(useTransport.getState()).isCurrent).toBe(true)

    const bystanderAfter = selectRowTransport(3)(useTransport.getState())
    expect(shallow(bystanderBefore, bystanderAfter)).toBe(true)
  })

  it('marks only the row whose Preview failed, keyed by id', () => {
    useTransport.getState().markFailed(7)
    expect(selectRowTransport(7)(useTransport.getState()).failed).toBe(true)
    expect(selectRowTransport(8)(useTransport.getState()).failed).toBe(false)
  })

  it('a Sound with no Preview URL and no bridge to fall back to fails instead of becoming current', () => {
    useTransport.getState().playSound(fakeSound(9, false))
    expect(selectRowTransport(9)(useTransport.getState()).failed).toBe(true)
  })
})

// ───────────── ticket 08: an Edit (no Preview) plays its local Original ─────────────

describe('transport store — an Edit with no Preview falls back to its local Original', () => {
  const originalWindow = (globalThis as { window?: unknown }).window

  afterEach(() => {
    ;(globalThis as { window?: unknown }).window = originalWindow
  })

  it('streams the local Original once getContentPath resolves a path', async () => {
    ;(globalThis as { window?: unknown }).window = {
      core: { getContentPath: async () => '/library/9-edited.wav' },
    }
    useTransport.getState().playSound(fakeSound(9, false))
    // The lookup is async — let it settle.
    await new Promise((r) => setTimeout(r, 0))

    expect(selectRowTransport(9)(useTransport.getState()).isCurrent).toBe(true)
    expect(selectRowTransport(9)(useTransport.getState()).failed).toBe(false)
  })

  it('fails the row when the Original is not on disk (a null content path)', async () => {
    ;(globalThis as { window?: unknown }).window = {
      core: { getContentPath: async () => null },
    }
    useTransport.getState().playSound(fakeSound(9, false))
    await new Promise((r) => setTimeout(r, 0))

    expect(selectRowTransport(9)(useTransport.getState()).failed).toBe(true)
  })
})
