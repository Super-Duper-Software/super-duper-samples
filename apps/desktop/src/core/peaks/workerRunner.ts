import { Worker } from 'node:worker_threads'
import { errorMessage } from '../errorMessage'
import type { PeakResult, PeakRunner } from './computeFromFile'
import type { PeakWorkerResponse } from './peakWorker'

/** The real runner: spawn a one-shot Worker thread and await its single message. */
export function workerRunner(workerPath: string): PeakRunner {
  return (filePath, targetBuckets, trim) =>
    new Promise<PeakResult>((resolve) => {
      let settled = false
      const done = (r: PeakResult): void => {
        if (settled) return
        settled = true
        resolve(r)
      }

      let worker: Worker
      try {
        worker = new Worker(workerPath, {
          workerData: { filePath, targetBuckets, trim },
        })
      } catch (err) {
        done({ ok: false, undecodable: false, error: errorMessage(err) })
        return
      }

      worker.once('message', (m: PeakWorkerResponse) => {
        if (m.ok) {
          done({
            ok: true,
            value: {
              sampleRate: m.sampleRate,
              bucketCount: m.bucketCount,
              data: new Int16Array(m.data),
            },
          })
        } else {
          done({ ok: false, undecodable: m.undecodable, error: m.error })
        }
        void worker.terminate()
      })
      worker.once('error', (err) => {
        done({ ok: false, undecodable: false, error: errorMessage(err) })
        void worker.terminate()
      })
      worker.once('exit', () =>
        done({
          ok: false,
          undecodable: false,
          error: 'worker exited without a result',
        }),
      )
    })
}
