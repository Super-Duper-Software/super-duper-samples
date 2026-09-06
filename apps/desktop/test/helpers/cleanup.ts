import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'

type Teardown = () => void | Promise<void>

const pending: Teardown[] = []

/**
 * Register a teardown to run after the current test, in reverse registration
 * order. Throwing teardowns are ignored — closing an already-closed core or DB
 * is a normal thing for a test to have done on purpose.
 */
export function onCleanup(fn: Teardown): void {
  pending.push(fn)
}

/** A temp directory that is removed after the current test. */
export async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  onCleanup(() => rm(dir, { recursive: true, force: true }))
  return dir
}

afterEach(async () => {
  for (const fn of pending.splice(0).reverse()) {
    try {
      await fn()
    } catch {
      /* ignore */
    }
  }
})
