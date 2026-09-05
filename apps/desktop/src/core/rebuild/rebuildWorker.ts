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
