import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { inspectDbHealth, type DbHealth } from '../db/index'
import { CONTENT_DIRNAME } from '../staging/contentStore'
import { NOT_RECOVERABLE_MESSAGE } from '../rebuild/rebuildService'

export interface StartupAssessment {
  /** Whether the database at `dbPath` can be used as-is. */
  db: DbHealth
  /** Number of `<id>.json` sidecars in `<dataDir>/content/`. */
  sidecarCount: number
  /**
   * `true` when the database is unusable AND at least one sidecar exists — the
   * renderer should offer a rebuild instead of showing an empty Library.
   */
  offerRebuild: boolean
  /** The honest sentence to show the user before they accept a rebuild. */
  notRecoverable: string
}

/** Count `<id>.json` sidecars in the content store. Absent dir -> 0. */
export function countSidecars(dataDir: string): number {
  try {
    return readdirSync(join(dataDir, CONTENT_DIRNAME)).filter((f) =>
      /^\d+\.json$/.test(f),
    ).length
  } catch {
    return 0
  }
}

export function assessStartup(opts: {
  dbPath: string
  dataDir: string
}): StartupAssessment {
  const db = inspectDbHealth(opts.dbPath)
  const sidecarCount = countSidecars(opts.dataDir)
  return {
    db,
    sidecarCount,
    offerRebuild: !db.ok && sidecarCount > 0,
    notRecoverable: NOT_RECOVERABLE_MESSAGE,
  }
}
