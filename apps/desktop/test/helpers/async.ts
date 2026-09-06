/** Real-timer sleep, for the paths that run on real timers (downloads, fs). */
export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms))

/** Poll `pred` every 5ms until it holds, or throw once `timeoutMs` has passed. */
export async function waitUntil(
  pred: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitUntil timed out after ${timeoutMs}ms`)
    }
    await sleep(5)
  }
}
