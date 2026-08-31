// The peak-computation Worker entry (ticket 12).
//
// Runs on a `node:worker_threads` thread — NOT the Electron main process and NOT
// the renderer — so decoding and the min/max sweep of a long recording never
// touch a thread that is drawing UI or servicing IPC. One Worker is spawned per
// computation and exits when it has posted its single result (computations are
// rare: once per Sound, ever).
//
// The protocol is a single `workerData` in, a single message out:
//   in : { filePath: string, targetBuckets: number }
//   out: PeakWorkerResponse (below)
//
// This file is a SEPARATE build entry (see electron.vite.config.ts) so it lands
// at `out/main/peakWorker.js` next to the compiled main bundle. `src/main` passes
// that path to the core as `peakWorkerPath`. Under Vitest the core is given a
// synchronous in-process runner instead and this file is never loaded.

import { parentPort, workerData } from 'node:worker_threads'
import { computePeaksFromFile } from './computeFromFile'

export interface PeakWorkerRequest {
  filePath: string
  targetBuckets: number
}

export type PeakWorkerResponse =
  | {
      ok: true
      sampleRate: number
      bucketCount: number
      /** Transferred Int16 buffer, interleaved [min,max] per bucket. */
      data: ArrayBuffer
    }
  | { ok: false; undecodable: boolean; error: string }

async function run(): Promise<void> {
  const port = parentPort
  if (!port) return
  const { filePath, targetBuckets } = workerData as PeakWorkerRequest
  const result = await computePeaksFromFile(filePath, targetBuckets)
  if (result.ok) {
    const { sampleRate, bucketCount, data } = result.value
    // Copy into a standalone ArrayBuffer we can hand over by transfer.
    const buf = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer
    const msg: PeakWorkerResponse = {
      ok: true,
      sampleRate,
      bucketCount,
      data: buf,
    }
    port.postMessage(msg, [buf])
  } else {
    const msg: PeakWorkerResponse = {
      ok: false,
      undecodable: result.undecodable,
      error: result.error,
    }
    port.postMessage(msg)
  }
}

void run()
