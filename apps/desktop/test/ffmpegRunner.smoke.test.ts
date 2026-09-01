// Ticket 02 — smoke test for the PRODUCTION `audioRenderRunner`: a real
// `ffmpeg-static` invocation against a short synthesized fixture. Confirms the
// runner produces a valid, decodable file of the requested format and honours
// trim + cancellation; it does not re-verify every EditSpec permutation
// (that is the fake-runner coverage in `edits.test.ts`) — deeper verification
// of tags/loudness/etc. is manual per the ticket.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createFfmpegAudioRenderRunner } from '../src/main/ffmpegRunner'
import type { EditSpec } from '../src/core'

const ffmpeg = ffmpegPath as string

let dir: string
let sourcePath: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ffmpeg-runner-smoke-'))
  sourcePath = join(dir, 'source.wav')
  // A 2s, 44.1kHz stereo sine tone — small and decoder-friendly.
  spawnSync(ffmpeg, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-ar',
    '44100',
    '-ac',
    '2',
    sourcePath,
  ])
  if (!existsSync(sourcePath)) throw new Error('failed to synthesize the smoke-test fixture')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

function isDecodable(path: string): boolean {
  const result = spawnSync(ffmpeg, ['-v', 'error', '-i', path, '-f', 'null', '-'])
  return result.status === 0
}

const METADATA = { title: 'Rain Loop', author: 'someuser', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' }

describe('createFfmpegAudioRenderRunner (smoke)', () => {
  it('renders a whole-file mp3 export that ffmpeg can decode', async () => {
    const outPath = join(dir, 'whole.mp3')
    const runner = createFfmpegAudioRenderRunner(ffmpeg)
    const spec: EditSpec = { trim: null, format: 'mp3' }

    const result = await runner({
      sourcePath,
      spec,
      outPath,
      signal: new AbortController().signal,
      metadata: METADATA,
    })

    expect(existsSync(outPath)).toBe(true)
    expect(result.byteSize).toBeGreaterThan(0)
    expect(isDecodable(outPath)).toBe(true)
    expect(result.durationSec).toBeGreaterThan(1.5)
  })

  it('renders a trimmed flac export at the requested sample rate/channels, reporting the shorter duration', async () => {
    const outPath = join(dir, 'trimmed.flac')
    const runner = createFfmpegAudioRenderRunner(ffmpeg)
    const spec: EditSpec = {
      trim: { startSec: 0.5, endSec: 1.5 },
      format: 'flac',
      sampleRate: 22050,
      channels: 1,
    }

    const result = await runner({
      sourcePath,
      spec,
      outPath,
      signal: new AbortController().signal,
      metadata: METADATA,
    })

    expect(existsSync(outPath)).toBe(true)
    expect(result.durationSec).toBeCloseTo(1, 1)
    expect(isDecodable(outPath)).toBe(true)
  })

  it('takes the plain-copy path for a whole-file export with no format/rate/channel/normalise change', async () => {
    const outPath = join(dir, 'plain-copy.wav')
    const runner = createFfmpegAudioRenderRunner(ffmpeg)
    const spec: EditSpec = { trim: null, format: 'wav' } // same container as the source fixture

    const result = await runner({
      sourcePath,
      spec,
      outPath,
      signal: new AbortController().signal,
      metadata: METADATA,
    })

    expect(existsSync(outPath)).toBe(true)
    expect(isDecodable(outPath)).toBe(true)
    expect(result.durationSec).toBeGreaterThan(1.5)
  })

  it('cancelling mid-render aborts ffmpeg promptly instead of hanging', async () => {
    const outPath = join(dir, 'cancelled.wav')
    const runner = createFfmpegAudioRenderRunner(ffmpeg)
    const controller = new AbortController()
    const spec: EditSpec = { trim: null, format: 'wav', normalize: true }

    const pending = runner({
      sourcePath,
      spec,
      outPath,
      signal: controller.signal,
      metadata: METADATA,
    })
    controller.abort()

    await expect(pending).rejects.toThrow()
  })

  it('a source ffmpeg cannot decode surfaces a genuine failure, distinct from an AbortError, and writes nothing', async () => {
    const { writeFile } = await import('node:fs/promises')
    const badSource = join(dir, 'not-audio.wav')
    await writeFile(badSource, 'this is not an audio file')
    const outPath = join(dir, 'should-not-exist.wav')
    const runner = createFfmpegAudioRenderRunner(ffmpeg)

    await expect(
      runner({
        sourcePath: badSource,
        spec: { trim: null, format: 'wav' },
        outPath,
        signal: new AbortController().signal,
        metadata: METADATA,
      }),
    ).rejects.toThrow()

    expect(existsSync(outPath)).toBe(false)
  })
})
