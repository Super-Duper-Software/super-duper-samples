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
