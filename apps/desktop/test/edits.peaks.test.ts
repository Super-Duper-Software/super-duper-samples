import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AudioRenderRunner, EditSpec } from '../src/core'
import { computePeaksFromFile } from '../src/core/peaks/computeFromFile'
import { makeFakeGateway, makeTestCore } from './helpers/makeTestCore'

const RAIN = { id: 321967, ext: 'wav' }
const THUNDER_MP3 = { id: 233001 }

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
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
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

/** Reads the fixed 44-byte-header mono 16-bit PCM WAV shape `makeSplitAmplitudeWav` writes. */
function readWavHeader(buf: Buffer): { sampleRate: number; frames: number } {
  return { sampleRate: buf.readUInt32LE(24), frames: (buf.length - 44) / 2 }
}

/** Slices a WAV's PCM data to `trim` (or the whole file), fixing up both size fields. */
function sliceWav(buf: Buffer, trim: { startSec: number; endSec: number } | null): Buffer {
  const { sampleRate, frames } = readWavHeader(buf)
  const startFrame = trim ? Math.max(0, Math.round(trim.startSec * sampleRate)) : 0
  const endFrame = trim ? Math.min(frames, Math.round(trim.endSec * sampleRate)) : frames
  const sliceBytes = buf.subarray(44 + startFrame * 2, 44 + endFrame * 2)
  const out = Buffer.alloc(44 + sliceBytes.length)
  buf.copy(out, 0, 0, 44)
  out.writeUInt32LE(36 + sliceBytes.length, 4)
  out.writeUInt32LE(sliceBytes.length, 40)
  sliceBytes.copy(out, 44)
  return out
}

/**
 * A render runner that actually honours `spec.trim` against the real source
 * bytes — a step up from `wavRenderRunner`'s fixed dummy output, needed now
 * that peaks are computed from the EDIT'S OWN rendered file rather than
 * sliced from the parent's decode: a test proving "the peaks reflect the
 * trimmed window" needs the rendered file to genuinely BE that window.
 */
function trimmingWavRenderRunner(): AudioRenderRunner {
  return async ({ sourcePath, spec, outPath }) => {
    const { readFile, writeFile } = await import('node:fs/promises')
    const src = await readFile(sourcePath)
    const out = sliceWav(src, spec.trim)
    await writeFile(outPath, out)
    const { sampleRate, frames } = readWavHeader(src)
    const durationSec = spec.trim
      ? spec.trim.endSec - spec.trim.startSec
      : frames / sampleRate
    return { byteSize: out.byteLength, durationSec }
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
  it("an Edit created from a WAV parent has peaks decoded from its OWN rendered (trimmed) file", async () => {
    const sampleRate = 8000
    const totalSec = 20
    const wav = makeSplitAmplitudeWav({ totalSec, sampleRate, loudAmp: 0.9, quietAmp: 0.2 })

    const { core, dataDir } = await makeTestCore({
      gateway: makeFakeGateway({ downloadBytes: wav }),
      audioRenderRunner: trimmingWavRenderRunner(),
      computePeaksRunner: inProcessPeakRunner,
    })
    cleanups.push(() => core.close())
    await stage(core, 'rain', RAIN.id)

    const spec: EditSpec = { trim: { startSec: 2, endSec: 5 }, format: 'wav' }
    const { editId } = (await core.createEdit(RAIN.id, spec))!
    expect(editId).toBeLessThan(0)

    core.requestPeaks(editId)
    await waitUntil(() => core.getPeaks(editId) != null)
    const peaks = core.getPeaks(editId)!

    expect(peaks.bucketCount).toBeGreaterThan(0)
    expect(peaks.sampleRate).toBe(sampleRate)

    const maxVal = Math.max(...peaks.peaks)
    const minVal = Math.min(...peaks.peaks)
    expect(maxVal).toBeGreaterThan(0.8)
    expect(minVal).toBeLessThan(-0.8)

    const leftovers = readdirSync(join(dataDir, 'content')).filter((f) =>
      f.includes('peaks-scratch'),
    )
    expect(leftovers).toEqual([])
  })

  it('an Edit with no trim gets peaks spanning its own whole rendered file', async () => {
    const sampleRate = 8000
    const totalSec = 20
    const wav = makeSplitAmplitudeWav({ totalSec, sampleRate, loudAmp: 0.9, quietAmp: 0.2 })

    const { core } = await makeTestCore({
      gateway: makeFakeGateway({ downloadBytes: wav }),
      audioRenderRunner: trimmingWavRenderRunner(),
      computePeaksRunner: inProcessPeakRunner,
    })
    cleanups.push(() => core.close())
    await stage(core, 'rain', RAIN.id)

    const { editId } = (await core.createEdit(RAIN.id, { trim: null, format: 'wav' }))!
    core.requestPeaks(editId)
    await waitUntil(() => core.getPeaks(editId) != null)
    const peaks = core.getPeaks(editId)!

    expect(Math.max(...peaks.peaks)).toBeGreaterThan(0.8)
    const hasQuietBucket = peaks.peaks.some((v) => Math.abs(v) < 0.35 && Math.abs(v) > 0.05)
    expect(hasQuietBucket).toBe(true)
  })

  it("recomputes peaks from the Edit's own file when the export changes the audio itself (loudness-normalise)", async () => {
    const sampleRate = 8000
    const wav = makeSplitAmplitudeWav({
      totalSec: 4,
      sampleRate,
      loudAmp: 0.2,
      quietAmp: 0.2,
    })
    const normalisingRunner: AudioRenderRunner = async ({ sourcePath, outPath }) => {
      const { readFile, writeFile } = await import('node:fs/promises')
      const src = await readFile(sourcePath)
      const { frames } = readWavHeader(src)
      const boosted = Buffer.from(src)
      for (let i = 0; i < frames; i++) {
        const v = boosted.readInt16LE(44 + i * 2)
        boosted.writeInt16LE(Math.max(-32767, Math.min(32767, v * 4)), 44 + i * 2)
      }
      await writeFile(outPath, boosted)
      return { byteSize: boosted.byteLength, durationSec: frames / sampleRate }
    }

    const { core } = await makeTestCore({
      gateway: makeFakeGateway({ downloadBytes: wav }),
      audioRenderRunner: normalisingRunner,
      computePeaksRunner: inProcessPeakRunner,
    })
    cleanups.push(() => core.close())
    await stage(core, 'rain', RAIN.id)

    const { editId } = (await core.createEdit(RAIN.id, {
      trim: null,
      format: 'wav',
      normalize: true,
    }))!
    core.requestPeaks(editId)
    await waitUntil(() => core.getPeaks(editId) != null)
    const peaks = core.getPeaks(editId)!

    expect(Math.max(...peaks.peaks)).toBeGreaterThan(0.7)
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
