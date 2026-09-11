import type { ErrorTelemetry } from './errorTelemetry'

const QUIT_FLUSH_TIMEOUT_MS = 2_000

interface QuitApp {
  on(
    event: 'will-quit',
    listener: (event: { preventDefault(): void }) => void,
  ): unknown
  quit(): void
}

/** Delay final app shutdown for one best-effort, bounded telemetry flush. */
export function registerWillQuitHandler(
  app: QuitApp,
  errorTelemetry: Pick<ErrorTelemetry, 'flush' | 'stop'>,
  core: { close(): void },
  timeoutMs = QUIT_FLUSH_TIMEOUT_MS,
): void {
  let flushStarted = false
  let readyToQuit = false

  app.on('will-quit', (event) => {
    if (readyToQuit) return

    event.preventDefault()
    if (flushStarted) return
    flushStarted = true

    errorTelemetry.stop()
    core.close()

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
      timeoutId = setTimeout(resolve, timeoutMs)
    })
    const flush = Promise.resolve()
      .then(() => errorTelemetry.flush())
      .catch(() => {})

    void Promise.race([flush, timeout]).then(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      readyToQuit = true
      app.quit()
    })
  })
}
