// Ticket 08 regression — an Edit's negative id gets REUSED once a deleted
// Edit's id frees up (ADR-0005's `nextEditId`). `useTransport.currentSoundId`
// must not keep pointing at that id across the delete: otherwise the brand
// new Edit that lands on the same id reads as already "current" the instant
// it appears, and a click on its row calls `toggle()` (resume the stale
// loaded audio element) instead of `playSound()` (load the new file fresh) —
// the row plays the wrong audio until a different row is played first.
//
// No DOM: `useTransport.playSound` is exercised only far enough to set
// `currentSoundId`, via a stubbed `window.core` (mirrors
// `renderer.transport.test.ts`'s pattern for the same reason).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useLibrary } from '../src/renderer/store/useLibrary'
import { useTransport } from '../src/renderer/store/useTransport'

const originalWindow = (globalThis as { window?: unknown }).window

beforeEach(() => {
  useTransport.setState({
    status: 'idle',
    currentSoundId: null,
    currentSound: null,
    failedIds: new Set<number>(),
  })
  useLibrary.setState({ memberIds: new Set<number>(), revision: 0 })
})

afterEach(() => {
  ;(globalThis as { window?: unknown }).window = originalWindow
})

describe('useLibrary — forgetting the transport track on delete / id reuse', () => {
  it('remove() stops the transport when it is currently on the deleted id', async () => {
    ;(globalThis as { window?: unknown }).window = {
      core: { deleteFromLibrary: async () => {} },
    }
    useTransport.setState({ status: 'playing', currentSoundId: -1, currentSound: null })

    await useLibrary.getState().remove(-1)

    expect(useTransport.getState().currentSoundId).toBeNull()
    expect(useTransport.getState().status).toBe('idle')
  })

  it('remove() leaves an unrelated current track alone', async () => {
    ;(globalThis as { window?: unknown }).window = {
      core: { deleteFromLibrary: async () => {} },
    }
    useTransport.setState({ status: 'playing', currentSoundId: 42, currentSound: null })

    await useLibrary.getState().remove(-1)

    expect(useTransport.getState().currentSoundId).toBe(42)
    expect(useTransport.getState().status).toBe('playing')
  })

  it("noteCreated() stops the transport if it's already sitting on the reused id (belt and suspenders)", () => {
    useTransport.setState({ status: 'playing', currentSoundId: -1, currentSound: null })

    useLibrary.getState().noteCreated(-1)

    expect(useTransport.getState().currentSoundId).toBeNull()
  })
})
