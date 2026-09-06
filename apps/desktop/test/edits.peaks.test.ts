import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { EditSpec } from '../src/core'
import {
  countingPeakRunner,
  editPath,
  fakeRenderRunner,
  listContent,
  makeFakeGateway,
  makeSplitAmplitudeWav,
  makeTestCore,
  makeWav,
  RAIN,
  readWavHeader,
  signInAndDownload,
  THUNDER_MP3,
  trimmingWavRenderRunner,
  waitUntil,
} from './helpers'

describe('ticket 03 — computed waveform peaks for an Edit', () => {
  it('an Edit created from a WAV parent has peaks decoded from its OWN rendered (trimmed) file', async () => {
    const sampleRate = 8000
    const totalSec = 20
    const wav = makeSplitAmplitudeWav({
      totalSec,
      sampleRate,
      loudAmp: 0.9,
      quietAmp: 0.2,
    })

    const { core, dataDir } = await makeTestCore({
      gateway: makeFakeGateway({ downloadBytes: wav }),
      audioRenderRunner: trimmingWavRenderRunner(),
      computePeaksRunner: countingPeakRunner(),
    })
    await signInAndDownload(core, RAIN.id)

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

    expect(
      listContent(dataDir).filter((f) => f.includes('peaks-scratch')),
    ).toEqual([])
  })

  it('an Edit with no trim gets peaks spanning its own whole rendered file', async () => {
    const sampleRate = 8000
    const totalSec = 20
    const wav = makeSplitAmplitudeWav({
      totalSec,
      sampleRate,
      loudAmp: 0.9,
      quietAmp: 0.2,
    })

    const { core } = await makeTestCore({
      gateway: makeFakeGateway({ downloadBytes: wav }),
      audioRenderRunner: trimmingWavRenderRunner(),
      computePeaksRunner: countingPeakRunner(),
    })
    await signInAndDownload(core, RAIN.id)

    const { editId } = (await core.createEdit(RAIN.id, {
      trim: null,
      format: 'wav',
    }))!
    core.requestPeaks(editId)
    await waitUntil(() => core.getPeaks(editId) != null)
    const peaks = core.getPeaks(editId)!

    expect(Math.max(...peaks.peaks)).toBeGreaterThan(0.8)
    const hasQuietBucket = peaks.peaks.some(
      (v) => Math.abs(v) < 0.35 && Math.abs(v) > 0.05,
    )
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
    const normalisingRunner = fakeRenderRunner({
      bytes: async ({ sourcePath }) => {
        const { readFile } = await import('node:fs/promises')
        const src = await readFile(sourcePath)
        const { frames } = readWavHeader(src)
        const boosted = Buffer.from(src)
        for (let i = 0; i < frames; i++) {
          const v = boosted.readInt16LE(44 + i * 2)
          boosted.writeInt16LE(
            Math.max(-32767, Math.min(32767, v * 4)),
            44 + i * 2,
          )
        }
        return boosted
      },
      durationSec: 4,
    })

    const { core } = await makeTestCore({
      gateway: makeFakeGateway({ downloadBytes: wav }),
      audioRenderRunner: normalisingRunner,
      computePeaksRunner: countingPeakRunner(),
    })
    await signInAndDownload(core, RAIN.id)

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
      gateway: makeFakeGateway({
        downloadBytes: new TextEncoder().encode('NOT-REAL-MP3-BYTES'),
      }),
      audioRenderRunner: fakeRenderRunner({ bytes: () => makeWav(4000) }),
      computePeaksRunner: countingPeakRunner(),
    })
    await signInAndDownload(core, THUNDER_MP3.id, 'thunder')

    const { editId } = (await core.createEdit(THUNDER_MP3.id, {
      trim: null,
      format: 'mp3',
    }))!
    expect(editId).toBeLessThan(0)

    core.requestPeaks(editId)
    await waitUntil(() => core.getPeaks(editId) != null)
    const peaks = core.getPeaks(editId)!
    expect(peaks.bucketCount).toBeGreaterThan(0)

    expect(
      listContent(dataDir).filter((f) => f.includes('peaks-scratch')),
    ).toEqual([])
  })

  it('deleting the Edit drops its peaks row along with its file and sounds row', async () => {
    const sampleRate = 8000
    const wav = makeSplitAmplitudeWav({
      totalSec: 5,
      sampleRate,
      loudAmp: 0.6,
      quietAmp: 0.6,
    })

    const { core, dataDir } = await makeTestCore({
      gateway: makeFakeGateway({ downloadBytes: wav }),
      audioRenderRunner: fakeRenderRunner({ bytes: () => makeWav(4000) }),
      computePeaksRunner: countingPeakRunner(),
    })
    await signInAndDownload(core, RAIN.id)

    const { editId } = (await core.createEdit(RAIN.id, {
      trim: null,
      format: 'wav',
    }))!
    core.requestPeaks(editId)
    await waitUntil(() => core.getPeaks(editId) != null)
    expect(core.getPeaks(editId)).not.toBeNull()

    const edited = editPath(dataDir, RAIN)
    expect(existsSync(edited)).toBe(true)

    await core.deleteFromLibrary(editId)

    expect(core.getPeaks(editId)).toBeNull()
    expect(existsSync(edited)).toBe(false)
    expect(core.listLibrary().some((s) => s.id === editId)).toBe(false)
  })
})
