import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { shallow } from 'zustand/shallow'
import { __resetForTest } from '../src/renderer/store/audioController'
import { selectRowTransport, useTransport } from '../src/renderer/store/useTransport'
import { fakeSound } from './helpers'

/** A Sound whose Preview URLs are real-looking, or empty for "no Preview". */
const soundWithPreview = (id: number, withPreview = true) =>
  fakeSound(id, {
    tags: [],
    previewUrls: {
      hqMp3: withPreview ? `https://cdn.freesound.org/previews/${id}-hq.mp3` : '',
      lqMp3: withPreview ? `https://cdn.freesound.org/previews/${id}-lq.mp3` : '',
      hqOgg: '',
      lqOgg: '',
    },
  })

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
    useTransport.getState().playSound(soundWithPreview(1))

    const before = selectRowTransport(2)(useTransport.getState())

    useTransport.getState().setVolume(0.1)
    useTransport.getState().setLoop(true)
    useTransport.getState().seekFraction(0.5)

    const after = selectRowTransport(2)(useTransport.getState())
    expect(shallow(before, after)).toBe(true)
  })

  it('starting a track flips isCurrent for exactly the two rows involved', () => {
    useTransport.getState().playSound(soundWithPreview(1))
    expect(selectRowTransport(1)(useTransport.getState()).isCurrent).toBe(true)
    expect(selectRowTransport(2)(useTransport.getState()).isCurrent).toBe(false)

    const bystanderBefore = selectRowTransport(3)(useTransport.getState())

    useTransport.getState().playSound(soundWithPreview(2))
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
    useTransport.getState().playSound(soundWithPreview(9, false))
    expect(selectRowTransport(9)(useTransport.getState()).failed).toBe(true)
  })
})

describe('transport store — an Edit with no Preview falls back to its local Original', () => {
  const originalWindow = (globalThis as { window?: unknown }).window

  afterEach(() => {
    ;(globalThis as { window?: unknown }).window = originalWindow
  })

  it('streams the local Original once getContentPath resolves a path', async () => {
    ;(globalThis as { window?: unknown }).window = {
      core: { getContentPath: async () => '/library/9-edited.wav' },
    }
    useTransport.getState().playSound(soundWithPreview(9, false))
    await new Promise((r) => setTimeout(r, 0))

    expect(selectRowTransport(9)(useTransport.getState()).isCurrent).toBe(true)
    expect(selectRowTransport(9)(useTransport.getState()).failed).toBe(false)
  })

  it('fails the row when the Original is not on disk (a null content path)', async () => {
    ;(globalThis as { window?: unknown }).window = {
      core: { getContentPath: async () => null },
    }
    useTransport.getState().playSound(soundWithPreview(9, false))
    await new Promise((r) => setTimeout(r, 0))

    expect(selectRowTransport(9)(useTransport.getState()).failed).toBe(true)
  })
})
