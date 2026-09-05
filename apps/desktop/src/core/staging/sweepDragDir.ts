import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Logger } from '../logging/logger'

/**
 * Empty `<dataDir>/drag/` of stale hardlinks. The links only matter for the
 * lifetime of an active OS drag, so anything still there at startup is from a
 * previous run and safe to unlink. Best-effort and silent.
 */
export function sweepDragDir(dataDir: string, logger: Logger): void {
  const dir = join(dataDir, 'drag')
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  let removed = 0
  for (const name of entries) {
    try {
      rmSync(join(dir, name), { force: true, recursive: false })
      removed += 1
    } catch {
      // A link the OS still holds open from a drag that outlived us.
    }
  }
  if (removed > 0) logger.info('swept stale drag hardlinks', { removed })
}
