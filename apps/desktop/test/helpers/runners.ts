import { writeFile } from 'node:fs/promises'
import type {
  AudioRenderInput,
  AudioRenderRunner,
  EditSpec,
  PeakRunner,
} from '../../src/core'
import { computePeaksFromFile } from '../../src/core/peaks/computeFromFile'
import { sleep } from './async'

/** An Edit of the whole file, unchanged — the simplest spec a test can ask for. */
export const WHOLE_FILE_SPEC: EditSpec = { trim: null, format: 'wav' }

/** An `AudioRenderRunner` that also records what it was asked to render. */
export interface FakeRenderRunner extends AudioRenderRunner {
  readonly renders: AudioRenderInput[]
  readonly calls: number
  readonly specs: EditSpec[]
  readonly sourcePaths: string[]
}

type RenderBytes =
  | string
  | Buffer
  | ((input: AudioRenderInput) => string | Buffer | Promise<string | Buffer>)

function recording(
  render: (input: AudioRenderInput) => Promise<{
    byteSize: number
    durationSec: number
  }>,
): FakeRenderRunner {
  const renders: AudioRenderInput[] = []
  const runner = ((input: AudioRenderInput) => {
    renders.push(input)
    return render(input)
  }) as FakeRenderRunner
  Object.defineProperties(runner, {
    renders: { get: () => renders },
    calls: { get: () => renders.length },
    specs: { get: () => renders.map((r) => r.spec) },
    sourcePaths: { get: () => renders.map((r) => r.sourcePath) },
  })
  return runner
}

/**
 * A fast, deterministic render: writes `bytes` to `outPath` and reports
 * `durationSec`. Both may be functions of the render being asked for, which is
 * how a test makes the output depend on the spec or on the source file.
 */
export function fakeRenderRunner(
  opts: {
    bytes?: RenderBytes
    durationSec?: number | ((spec: EditSpec) => number)
  } = {},
): FakeRenderRunner {
  const { bytes = 'FAKE-EDIT-BYTES', durationSec = 3 } = opts
  return recording(async (input) => {
    const body = typeof bytes === 'function' ? await bytes(input) : bytes
    await writeFile(input.outPath, body)
    return {
      byteSize: Buffer.byteLength(body),
      durationSec:
        typeof durationSec === 'function'
          ? durationSec(input.spec)
          : durationSec,
    }
  })
}

/** A render that reports progress across `steps` before finishing. */
export function slowRenderRunner(steps: number[]): FakeRenderRunner {
  return recording(async ({ outPath, onProgress }) => {
    for (const p of steps) {
      onProgress?.(p)
      await sleep(5)
    }
    await writeFile(outPath, 'SLOW-BYTES')
    return { byteSize: 10, durationSec: 5 }
  })
}

/** A render that always fails — an unreadable source or an encode error. */
export function failingRenderRunner(
  message = 'encode error',
): FakeRenderRunner {
  return recording(async () => {
    throw new Error(message)
  })
}

/**
 * A render that blocks until `release()` is called, honouring abort meanwhile,
 * so a test can act while exactly one render is in flight.
 */
export function controllableRenderRunner(): {
  runner: FakeRenderRunner
  release: () => void
} {
  let release!: () => void
  const gate = new Promise<void>((res) => {
    release = res
  })
  const runner = recording(async ({ outPath, signal }) => {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(abortError())
        return
      }
      const onAbort = (): void => reject(abortError())
      signal.addEventListener('abort', onAbort, { once: true })
      void gate.then(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      })
    })
    await writeFile(outPath, 'RELEASED-BYTES')
    return { byteSize: 14, durationSec: 2 }
  })
  return { runner, release }
}

/** The rejection an aborted runner is expected to produce. */
export function abortError(): Error {
  const e = new Error('aborted')
  e.name = 'AbortError'
  return e
}

/** An in-process peak runner — the real decode + sweep, counting its calls. */
export function countingPeakRunner(): PeakRunner & { calls: number } {
  const r = ((filePath, targetBuckets, trim) => {
    r.calls += 1
    return computePeaksFromFile(filePath, targetBuckets, trim)
  }) as PeakRunner & { calls: number }
  r.calls = 0
  return r
}
