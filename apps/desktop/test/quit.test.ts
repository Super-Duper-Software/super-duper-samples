import { describe, expect, it, vi } from 'vitest'
import { registerWillQuitHandler } from '../src/main/quit'

function quitHarness(flush: () => Promise<void>, timeoutMs = 50) {
  let willQuit: ((event: { preventDefault(): void }) => void) | undefined
  const app = {
    on: vi.fn(
      (_event: 'will-quit', listener: typeof willQuit) => (willQuit = listener),
    ),
    quit: vi.fn(),
  }
  const telemetry = {
    flush: vi.fn(flush),
    stop: vi.fn(),
  }
  const core = { close: vi.fn() }
  registerWillQuitHandler(app, telemetry, core, timeoutMs)
  return { app, core, telemetry, emit: () => willQuit! }
}

describe('will-quit telemetry flush', () => {
  it('prevents repeated quit events while one flush settles', async () => {
    let resolveFlush: (() => void) | undefined
    const pending = new Promise<void>((resolve) => (resolveFlush = resolve))
    const { app, core, telemetry, emit } = quitHarness(() => pending)
    const event = { preventDefault: vi.fn() }

    emit()(event)
    emit()(event)
    await Promise.resolve()

    expect(event.preventDefault).toHaveBeenCalledTimes(2)
    expect(telemetry.stop).toHaveBeenCalledTimes(1)
    expect(telemetry.flush).toHaveBeenCalledTimes(1)
    expect(core.close).toHaveBeenCalledTimes(1)
    expect(app.quit).not.toHaveBeenCalled()

    resolveFlush!()
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledTimes(1))

    emit()(event)
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
  })

  it('resumes quitting when the flush reaches its timeout', async () => {
    vi.useFakeTimers()
    try {
      const { app, emit } = quitHarness(() => new Promise(() => {}), 50)
      emit()({ preventDefault: vi.fn() })

      await vi.advanceTimersByTimeAsync(50)

      expect(app.quit).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
