import { parentPort, workerData } from 'node:worker_threads'
import { computePeaksFromFile, type TrimWindow } from './computeFromFile'

export interface PeakWorkerRequest {
  filePath: string
  targetBuckets: number
  /** Slice the decode to this window (seconds) before the sweep — an Edit sliced from its parent (ticket 03). */
  trim?: TrimWindow | null
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
  const { filePath, targetBuckets, trim } = workerData as PeakWorkerRequest
  const result = await computePeaksFromFile(filePath, targetBuckets, trim)
  if (result.ok) {
    const { sampleRate, bucketCount, data } = result.value
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
