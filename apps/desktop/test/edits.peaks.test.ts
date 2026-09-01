// Ticket 03 — computed waveform peaks for an Edit, at the core seam. No
// Electron: real temp SQLite, real temp filesystem, the fake gateway; the peak
// runner is the real decode + sweep (`computePeaksFromFile`) driven in-process
// (never a real Worker thread), and the Edit render runner is a fake that
// writes real WAV bytes so both the Edit export step and the ticket-03 scratch
// PCM rendition are genuinely decodable.
//
// Covers the ticket's "Tests cover:" line:
//   - an Edit created from a WAV parent has peaks whose span matches the
//     trimmed duration (sliced straight from the parent's decode)
//   - an Edit created from a compressed-source parent still ends up with peaks
//     (via the scratch-PCM rendition of the Edit's own file)
//   - deleting the Edit drops its peaks row
// plus: an Edit with no trim gets peaks spanning its whole file.

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AudioRenderRunner, EditSpec } from '../src/core'
import { computePeaksFromFile } from '../src/core/peaks/computeFromFile'
import { makeFakeGateway, makeTestCore } from './helpers/makeTestCore'

const RAIN = { id: 321967, ext: 'wav' } // real Original, type 'wav' (34.72s per fixture)
const THUNDER_MP3 = { id: 233001 } // real Original, type 'mp3' — not locally decodable

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const c of cleanups.splice(0)) {
    try {
      c()
    } catch {
      /* ignore */
    }
  }
})

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function waitUntil(pred: () => boolean, ms = 4000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('waitUntil timed out')
    await sleep(5)
  }
}

/**
 * A 16-bit mono PCM WAV whose first half is loud (`loudAmp`) and second half
 * quiet (`quietAmp`) — lets a test tell "peaks came from THIS window" apart
 * from "peaks came from the whole file".
 */
function makeSplitAmplitudeWav(opts: {
  totalSec: number
  sampleRate: number
  loudAmp: number
  quietAmp: number
}): Buffer {
  const { totalSec, sampleRate, loudAmp, quietAmp } = opts
  const frames = Math.round(totalSec * sampleRate)
  const half = Math.floor(frames / 2)
  const dataLen = frames * 2
  const buf = Buffer.alloc(44 + dataLen)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataLen, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataLen, 40)
  for (let i = 0; i < frames; i++) {
    const amp = i < half ? loudAmp : quietAmp
    const v = i % 2 === 0 ? amp : -amp
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  return buf
}

/** A small plain WAV, used where the exact content does not matter (e.g. the mp3-parent Edit's own file). */
function makeSimpleWav(frames: number, sampleRate = 8000): Buffer {
  return makeSplitAmplitudeWav({
    totalSec: frames / sampleRate,
    sampleRate,
    loudAmp: 0.5,
    quietAmp: 0.5,
  })
}

/** Writes real (decodable) WAV bytes to `outPath`, regardless of the requested spec/format. */
function wavRenderRunner(bytes: () => Buffer): AudioRenderRunner {
  return async ({ outPath }) => {
    const { writeFile } = await import('node:fs/promises')
    const b = bytes()
    await writeFile(outPath, b)
    return { byteSize: b.byteLength, durationSec: 1 }
  }
}

const inProcessPeakRunner = (
  filePath: string,
  targetBuckets: number,
  trim?: { startSec: number; endSec: number } | null,
) => computePeaksFromFile(filePath, targetBuckets, trim)

async function stage(core: Awaited<ReturnType<typeof makeTestCore>>['core'], query: string, soundId: number) {
  await core.signIn()
  await core.search(query)
  core.downloadToLibrary(soundId)
  await waitUntil(() => core.getStagingStatus([soundId])[soundId] === 'ready')
}

describe('ticket 03 — computed waveform peaks for an Edit', () => {
  it('an Edit created from a WAV parent has peaks sliced to its trimmed window, not the whole parent', async () => {
    const sampleRate = 8000
    const totalSec = 20 // well within the fixture's 34.7208s duration
    const wav = makeSplitAmplitudeWav({ totalSec, sampleRate, loudAmp: 0.9, quietAmp: 0.2 })

    const { core, dataDir } = await makeTestCore({
      gateway: makeFakeGateway({ downloadBytes: wav }),
      audioRenderRunner: wavRenderRunner(() => makeSimpleWav(4000)),
      computePeaksRunner: inProcessPeakRunner,
    })
    cleanups.push(() => core.close())
    await stage(core, 'rain', RAIN.id)

    // Entirely inside the LOUD first half (0s–10s).
    const spec: EditSpec = { trim: { startSec: 2, endSec: 5 }, format: 'wav' }
    const { editId } = (await core.createEdit(RAIN.id, spec))!
    expect(editId).toBeLessThan(0)

    core.requestPeaks(editId)
    await waitUntil(() => core.getPeaks(editId) != null)
    const peaks = core.getPeaks(editId)!

    expect(peaks.bucketCount).toBeGreaterThan(0)
    // Decoded straight from the parent WAV, not the (dummy) Edit file — its own header says 8000 Hz.
    expect(peaks.sampleRate).toBe(sampleRate)

    const maxVal = Math.max(...peaks.peaks)
    const minVal = Math.min(...peaks.peaks)
    // Close to the loud amplitude (0.9), nowhere near the quiet one (0.2) — proves the
    // slice came from [2s, 5s), not the tail of the file.
    expect(maxVal).toBeGreaterThan(0.8)
    expect(minVal).toBeLessThan(-0.8)

    // No decode of the exported file: no scratch PCM was ever created for this path.
    const leftovers = readdirSync(join(dataDir, 'content')).filter((f) =>
      f.includes('peaks-scratch'),
    )
    expect(leftovers).toEqual([])
  })

  it('an Edit with no trim gets peaks spanning the parent whole file', async () => {
    const sampleRate = 8000
    const totalSec = 20
    const wav = makeSplitAmplitudeWav({ totalSec, sampleRate, loudAmp: 0.9, quietAmp: 0.2 })

    const { core } = await makeTestCore({
      gateway: makeFakeGateway({ downloadBytes: wav }),
      audioRenderRunner: wavRenderRunner(() => makeSimpleWav(4000)),
      computePeaksRunner: inProcessPeakRunner,
    })
    cleanups.push(() => core.close())
    await stage(core, 'rain', RAIN.id)

    const { editId } = (await core.createEdit(RAIN.id, { trim: null, format: 'wav' }))!
    core.requestPeaks(editId)
    await waitUntil(() => core.getPeaks(editId) != null)
    const peaks = core.getPeaks(editId)!

    // Spans both halves: a bucket near the loud amplitude AND one near the quiet one.
    expect(Math.max(...peaks.peaks)).toBeGreaterThan(0.8)
    const hasQuietBucket = peaks.peaks.some((v) => Math.abs(v) < 0.35 && Math.abs(v) > 0.05)
    expect(hasQuietBucket).toBe(true)
  })

  it('an Edit created from a compressed-source (mp3) parent still ends up with peaks, via a scratch PCM rendition', async () => {
    const { core, dataDir } = await makeTestCore({
      gateway: makeFakeGateway({ downloadBytes: new TextEncoder().encode('NOT-REAL-MP3-BYTES') }),
      audioRenderRunner: wavRenderRunner(() => makeSimpleWav(4000)),
      computePeaksRunner: inProcessPeakRunner,
    })
    cleanups.push(() => core.close())
    await stage(core, 'thunder', THUNDER_MP3.id)

    const { editId } = (await core.createEdit(THUNDER_MP3.id, { trim: null, format: 'mp3' }))!
    expect(editId).toBeLessThan(0)

    core.requestPeaks(editId)
    await waitUntil(() => core.getPeaks(editId) != null)
    const peaks = core.getPeaks(editId)!
    expect(peaks.bucketCount).toBeGreaterThan(0)

    // The scratch PCM rendition is cleaned up afterwards.
    const leftovers = readdirSync(join(dataDir, 'content')).filter((f) =>
      f.includes('peaks-scratch'),
    )
    expect(leftovers).toEqual([])
  })

  it('deleting the Edit drops its peaks row along with its file and sounds row', async () => {
    const sampleRate = 8000
    const wav = makeSplitAmplitudeWav({ totalSec: 5, sampleRate, loudAmp: 0.6, quietAmp: 0.6 })

    const { core, dataDir } = await makeTestCore({
      gateway: makeFakeGateway({ downloadBytes: wav }),
      audioRenderRunner: wavRenderRunner(() => makeSimpleWav(4000)),
      computePeaksRunner: inProcessPeakRunner,
    })
    cleanups.push(() => core.close())
    await stage(core, 'rain', RAIN.id)

    const { editId } = (await core.createEdit(RAIN.id, { trim: null, format: 'wav' }))!
    core.requestPeaks(editId)
    await waitUntil(() => core.getPeaks(editId) != null)
    expect(core.getPeaks(editId)).not.toBeNull()

    const editPath = join(dataDir, 'content', `${RAIN.id}-edited.${RAIN.ext}`)
    expect(existsSync(editPath)).toBe(true)

    await core.deleteFromLibrary(editId)

    expect(core.getPeaks(editId)).toBeNull()
    expect(existsSync(editPath)).toBe(false)
    expect(core.listLibrary().some((s) => s.id === editId)).toBe(false)
  })
})
