import { readFile, writeFile } from 'node:fs/promises'
import type { AudioRenderRunner } from '../../src/core'

const WAV_HEADER_BYTES = 44

/**
 * A mono 16-bit PCM WAV. `amplitudeAt` returns the envelope (0..1) for a frame;
 * successive frames alternate sign, so every bucket of the peak sweep sees both
 * a minimum and a maximum.
 */
export function makeWav(
  frames: number,
  {
    sampleRate = 8000,
    amplitudeAt = () => 0.5,
  }: { sampleRate?: number; amplitudeAt?: (frame: number) => number } = {},
): Buffer {
  const dataLen = frames * 2
  const buf = Buffer.alloc(WAV_HEADER_BYTES + dataLen)
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
    const v = amplitudeAt(i) * (i % 2 === 0 ? 1 : -1)
    buf.writeInt16LE(Math.round(v * 32767), WAV_HEADER_BYTES + i * 2)
  }
  return buf
}

/**
 * A WAV whose first half is loud and second half quiet — lets a test tell
 * "peaks came from THIS window" apart from "peaks came from the whole file".
 */
export function makeSplitAmplitudeWav(opts: {
  totalSec: number
  sampleRate: number
  loudAmp: number
  quietAmp: number
}): Buffer {
  const frames = Math.round(opts.totalSec * opts.sampleRate)
  const half = Math.floor(frames / 2)
  return makeWav(frames, {
    sampleRate: opts.sampleRate,
    amplitudeAt: (i) => (i < half ? opts.loudAmp : opts.quietAmp),
  })
}

export function readWavHeader(buf: Buffer): {
  sampleRate: number
  frames: number
} {
  return {
    sampleRate: buf.readUInt32LE(24),
    frames: (buf.length - WAV_HEADER_BYTES) / 2,
  }
}

/** Slice a `makeWav` buffer to `trim` (or the whole file), fixing both size fields. */
export function sliceWav(
  buf: Buffer,
  trim: { startSec: number; endSec: number } | null,
): Buffer {
  const { sampleRate, frames } = readWavHeader(buf)
  const startFrame = trim
    ? Math.max(0, Math.round(trim.startSec * sampleRate))
    : 0
  const endFrame = trim
    ? Math.min(frames, Math.round(trim.endSec * sampleRate))
    : frames
  const sliceBytes = buf.subarray(
    WAV_HEADER_BYTES + startFrame * 2,
    WAV_HEADER_BYTES + endFrame * 2,
  )
  const out = Buffer.alloc(WAV_HEADER_BYTES + sliceBytes.length)
  buf.copy(out, 0, 0, WAV_HEADER_BYTES)
  out.writeUInt32LE(36 + sliceBytes.length, 4)
  out.writeUInt32LE(sliceBytes.length, 40)
  sliceBytes.copy(out, WAV_HEADER_BYTES)
  return out
}

/**
 * A render runner that honours `spec.trim` against the real source bytes, so
 * the rendered file genuinely IS the trimmed window — what a test asserting
 * "the peaks reflect the trim" needs, now that peaks are computed from the
 * Edit's own file rather than sliced from the parent's decode.
 */
export function trimmingWavRenderRunner(): AudioRenderRunner {
  return async ({ sourcePath, spec, outPath }) => {
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

/** A mono 16-bit PCM AIFF, samples ±0.25 — the other container the decoder takes. */
export function makeAiff(frames: number, sampleRate = 8000): Buffer {
  const dataLen = frames * 2
  const ssndLen = 8 + dataLen
  const buf = Buffer.alloc(12 + 8 + 18 + 8 + ssndLen)
  let p = 0
  buf.write('FORM', p)
  p += 4
  buf.writeUInt32LE(0, p)
  p += 4
  buf.writeUInt32BE(4 + 8 + 18 + 8 + ssndLen, 4)
  buf.write('AIFF', p)
  p += 4
  buf.write('COMM', p)
  p += 4
  buf.writeUInt32BE(18, p)
  p += 4
  buf.writeUInt16BE(1, p)
  p += 2
  buf.writeUInt32BE(frames, p)
  p += 4
  buf.writeUInt16BE(16, p)
  p += 2
  writeExtended(buf, p, sampleRate)
  p += 10
  buf.write('SSND', p)
  p += 4
  buf.writeUInt32BE(ssndLen, p)
  p += 4
  buf.writeUInt32BE(0, p)
  p += 4
  buf.writeUInt32BE(0, p)
  p += 4
  for (let i = 0; i < frames; i++) {
    const v = i % 2 === 0 ? 0.25 : -0.25
    buf.writeInt16BE(Math.round(v * 32767), p + i * 2)
  }
  return buf
}

/** The 80-bit IEEE extended float AIFF stores its sample rate in. */
function writeExtended(buf: Buffer, offset: number, value: number): void {
  let mantissa = value
  let exponent = 16383 + 63
  while (mantissa < 2 ** 63 && exponent > 0) {
    mantissa *= 2
    exponent -= 1
  }
  while (mantissa >= 2 ** 64) {
    mantissa /= 2
    exponent += 1
  }
  buf.writeUInt16BE(exponent, offset)
  const hi = Math.floor(mantissa / 2 ** 32)
  const lo = mantissa >>> 0
  buf.writeUInt32BE(hi >>> 0, offset + 2)
  buf.writeUInt32BE(lo, offset + 6)
}
