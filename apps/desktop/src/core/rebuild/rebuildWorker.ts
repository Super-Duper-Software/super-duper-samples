// The rebuild scan Worker entry (ticket 14).
//
// Runs the read-only sidecar scan on a `node:worker_threads` thread — NOT the
// Electron main process — so classifying a large content store (readdir + a
// JSON.parse per sidecar) never blocks IPC or the UI. It posts `progress`
// messages as it goes and one final `done` (or `error`).
//
// This file is a SEPARATE build entry (see electron.vite.config.ts) so it lands
// at `out/main/rebuildWorker.js` next to the compiled main bundle. `src/main`
// passes that path to the core as `rebuildWorkerPath`. Under Vitest the core is
// given an in-process runner instead and this file is never loaded.

import { parentPort, workerData } from 'node:worker_threads'
import { scanSidecars } from './scanSidecars'
import type { RebuildWorkerMessage } from './rebuildService'

async function run(): Promise<void> {
  const port = parentPort
  if (!port) return
  const { contentDir } = workerData as { contentDir: string }
  try {
    const scan = await scanSidecars(contentDir, (p) => {
      const msg: RebuildWorkerMessage = {
        type: 'progress',
        done: p.done,
        total: p.total,
      }
      port.postMessage(msg)
    })
    const msg: RebuildWorkerMessage = { type: 'done', scan }
    port.postMessage(msg)
  } catch (err) {
    const msg: RebuildWorkerMessage = {
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    }
    port.postMessage(msg)
  }
}

void run()
