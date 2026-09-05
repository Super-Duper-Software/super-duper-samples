import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from '../src/core/db/index'
import { getPeaksRecord, putPeaksRecord } from '../src/core/db/peaks'
import { upsertSound } from '../src/core/db/sounds'
import { upsertStagedEntry } from '../src/core/db/staged'
import { writeOriginal } from '../src/core/staging/contentStore'
import { evictStagedOverBudget } from '../src/core/staging/eviction'
import { createDragRegistry } from '../src/core/staging/dragRegistry'
import {
  decodeAudioBuffer,
  UndecodableAudioError,
} from '../src/core/peaks/decodeAudio'
import { computePeaks } from '../src/core/peaks/computePeaks'
import { computePeaksFromFile } from '../src/core/peaks/computeFromFile'
import { workerRunner } from '../src/core/peaks/peakService'
import type { AudioRenderRunner, PeakRunner } from '../src/core'
import type { Sound } from '../src/core/types'
import { makeFakeGateway, makeTestCore } from './helpers/makeTestCore'

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

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms))
async function waitUntil(pred: () => boolean, ms = 4000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('waitUntil timed out')
    await sleep(5)
  }
}

/** A 16-bit PCM WAV (mono) whose samples are `frames` long, with a peak at 0.5. */
function makeWav(frames: number, sampleRate = 8000): Buffer {
  const channels = 1
  const bytesPerSample = 2
  const dataLen = frames * channels * bytesPerSample
  const buf = Buffer.alloc(44 + dataLen)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataLen, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * channels * bytesPerSample, 28)
  buf.writeUInt16LE(channels * bytesPerSample, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataLen, 40)
  for (let i = 0; i < frames; i++) {
    const v = i % 2 === 0 ? 0.5 : -0.5
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  return buf
}

/** A 16-bit PCM AIFF (mono), samples ±0.25. */
function makeAiff(frames: number, sampleRate = 8000): Buffer {
  const channels = 1
  const dataLen = frames * channels * 2
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
  buf.writeUInt16BE(channels, p)
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

function fakeSound(id: number, over: Partial<Sound> = {}): Sound {
  return {
    id,
    name: `sound ${id}`,
    username: 'tester',
    license: {
      url: 'http://creativecommons.org/publicdomain/zero/1.0/',
      name: 'CC0',
    },
    duration: 3,
    tags: ['test'],
    filesize: 1,
    type: 'wav',
    samplerate: 8000,
    channels: 1,
    bitdepth: 16,
    previewUrls: { hqMp3: 'hq.mp3', lqMp3: 'lq.mp3', hqOgg: '', lqOgg: '' },
    waveformUrls: { m: 'm.png', l: 'l.png' },
    url: `https://freesound.org/s/${id}/`,
    downloadCount: 0,
    avgRating: 0,
    created: '2020-01-01T00:00:00Z',
    ...over,
  }
}

/** An in-process runner backed by the real decode + sweep, counting its calls. */
function countingRunner(): PeakRunner & { calls: number } {
  const r = ((filePath, buckets) => {
    r.calls += 1
    return computePeaksFromFile(filePath, buckets)
  }) as PeakRunner & { calls: number }
  r.calls = 0
  return r
}

function openTemp(dbPath: string): DB {
  const db = openDb(dbPath)
  cleanups.push(() => {
    try {
      db.close()
    } catch {
      /* already closed */
    }
  })
  return db
}

describe('decodeAudioBuffer + computePeaks', () => {
  it('decodes a 16-bit PCM WAV and reduces it to a correct min/max envelope', () => {
    const decoded = decodeAudioBuffer(makeWav(4000))
    expect(decoded.sampleRate).toBe(8000)
    expect(decoded.channelData).toHaveLength(1)
    expect(decoded.length).toBe(4000)

    const peaks = computePeaks(decoded, 100)
    expect(peaks.bucketCount).toBe(100)
    expect(peaks.data).toHaveLength(200)
    for (let b = 0; b < peaks.bucketCount; b++) {
      expect(peaks.data[b * 2]).toBeLessThan(-16000)
      expect(peaks.data[b * 2 + 1]).toBeGreaterThan(16000)
    }
  })

  it('decodes a 16-bit AIFF', () => {
    const decoded = decodeAudioBuffer(makeAiff(2000))
    expect(decoded.sampleRate).toBe(8000)
    expect(decoded.length).toBe(2000)
    const peaks = computePeaks(decoded, 50)
    expect(peaks.data[1]).toBeGreaterThan(7000)
    expect(peaks.data[0]).toBeLessThan(-7000)
  })

  it('rejects bytes that are not a container it understands', () => {
    expect(() => decodeAudioBuffer(Buffer.from('FAKE-ORIGINAL:123'))).toThrow(
      UndecodableAudioError,
    )
    expect(() =>
      decodeAudioBuffer(Buffer.from('not audio at all, really')),
    ).toThrow(/unsupported audio container/i)
  })
})

describe('workerRunner — computation runs on a real worker_threads thread', () => {
  it('spawns a Worker, hands it the file, and returns the envelope from another thread', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'peaks-worker-'))
    const workerJs = join(dir, 'worker.mjs')
    writeFileSync(
      workerJs,
      `
      import { parentPort, workerData, threadId } from 'node:worker_threads'
      import { readFileSync } from 'node:fs'
      if (threadId < 1) { parentPort.postMessage({ ok: false, undecodable: false, error: 'ran on main thread' }); }
      else {
        // Minimal 16-bit PCM WAV mono decode → single-bucket min/max.
        const b = readFileSync(workerData.filePath)
        let dataOff = 44
        let min = 1, max = -1
        for (let i = dataOff; i + 1 < b.length; i += 2) {
          const s = b.readInt16LE(i) / 32768
          if (s < min) min = s
          if (s > max) max = s
        }
        const int16 = new Int16Array([Math.round(min * 32767), Math.round(max * 32767)])
        const buf = int16.buffer.slice(0)
        parentPort.postMessage({ ok: true, sampleRate: 8000, bucketCount: 1, data: buf }, [buf])
      }
      `,
      'utf8',
    )
    const wavPath = join(dir, 'a.wav')
    writeFileSync(wavPath, makeWav(1000))

    const run = workerRunner(workerJs)
    const result = await run(wavPath, 2000)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.bucketCount).toBe(1)
      expect(result.value.data[0]).toBeLessThan(-16000)
      expect(result.value.data[1]).toBeGreaterThan(16000)
    }
  })
})

describe('peaks are computed once per Sound and reused', () => {
  it('computes on stage, serves from the DB cache, and a fresh core never recomputes', async () => {
    const wav = makeWav(20000)
    const gateway = makeFakeGateway({ downloadBytes: () => wav })
    const runner = countingRunner()
    const events: Array<{ soundId: number; status: string }> = []
    const tc = await makeTestCore({
      gateway,
      computePeaksRunner: runner,
      onPeaksStatusChange: (c) => events.push(c),
    })
    cleanups.push(() => tc.core.close())
    await tc.core.signIn()
    tc.core.grantStagingConsent()

    const page = await tc.core.search('rain')
    const id = page.sounds[0]!.id

    tc.core.stageOnAudition(id)
    await waitUntil(() => tc.core.getStagingStatus([id])[id] === 'ready')
    await waitUntil(() => tc.core.getPeaks(id) != null)

    const peaks = tc.core.getPeaks(id)!
    expect(peaks.bucketCount).toBeGreaterThan(100)
    expect(peaks.peaks).toHaveLength(peaks.bucketCount * 2)
    expect(Math.min(...peaks.peaks)).toBeLessThan(-0.4)
    expect(Math.max(...peaks.peaks)).toBeGreaterThan(0.4)
    expect(runner.calls).toBe(1)
    expect(events.some((e) => e.soundId === id && e.status === 'ready')).toBe(
      true,
    )

    const throwingRunner: PeakRunner = () => {
      throw new Error('recomputed — cache was not used')
    }
    const tc2 = await makeTestCore({
      gateway,
      dbPath: tc.dbPath,
      computePeaksRunner: throwingRunner,
    })
    cleanups.push(() => tc2.core.close())
    const again = tc2.core.getPeaks(id)
    expect(again).not.toBeNull()
    expect(again!.bucketCount).toBe(peaks.bucketCount)
    tc2.core.requestPeaks(id)
    await sleep(20)
  })
})

describe('computing peaks for a long recording leaves the core responsive', () => {
  it('requestPeaks returns at once and every other command still answers while it runs', async () => {
    const wav = makeWav(20000)
    const gateway = makeFakeGateway({ downloadBytes: () => wav })

    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let started = false
    const slowRunner: PeakRunner = async (filePath, buckets) => {
      started = true
      await gate
      return computePeaksFromFile(filePath, buckets)
    }

    const tc = await makeTestCore({ gateway, computePeaksRunner: slowRunner })
    cleanups.push(() => tc.core.close())
    await tc.core.signIn()
    tc.core.grantStagingConsent()
    const page = await tc.core.search('rain')
    const id = page.sounds[0]!.id
    await writeOriginal(tc.dataDir, page.sounds[0]!, wav, Date.now())

    const t0 = Date.now()
    tc.core.requestPeaks(id)
    expect(Date.now() - t0).toBeLessThan(50)
    await waitUntil(() => started)

    expect(tc.core.getPeaks(id)).toBeNull()
    const r = await tc.core.search('thunder')
    expect(r.sounds.length).toBeGreaterThan(0)
    expect(tc.core.getStagingStatus([id])[id]).toBeDefined()
    expect(tc.core.getDragCapabilities()).toBeDefined()

    release()
    await waitUntil(() => tc.core.getPeaks(id) != null)
  })
})

describe('an Original that cannot be decoded falls back gracefully', () => {
  it('records a sentinel, getPeaks returns null (no throw), and it is not retried', async () => {
    const runner = countingRunner()
    const events: Array<{ soundId: number; status: string }> = []
    const tc = await makeTestCore({
      computePeaksRunner: runner,
      onPeaksStatusChange: (c) => events.push(c),
    })
    cleanups.push(() => tc.core.close())
    await tc.core.signIn()
    tc.core.grantStagingConsent()
    const page = await tc.core.search('rain')
    const id = page.sounds[0]!.id

    tc.core.stageOnAudition(id)
    await waitUntil(() => tc.core.getStagingStatus([id])[id] === 'ready')
    await waitUntil(() =>
      events.some((e) => e.soundId === id && e.status === 'unavailable'),
    )

    expect(() => tc.core.getPeaks(id)).not.toThrow()
    expect(tc.core.getPeaks(id)).toBeNull()

    const db = openTemp(tc.dbPath)
    const row = db
      .prepare('SELECT bucket_count FROM peaks WHERE sound_id = ?')
      .get(id) as { bucket_count: number } | undefined
    expect(row?.bucket_count).toBe(0)

    const callsAfterFirst = runner.calls
    tc.core.requestPeaks(id)
    await sleep(20)
    expect(runner.calls).toBe(callsAfterFirst)
  })
})

/** A render runner that writes real WAV bytes to `outPath` and counts its calls. */
function spyWavRenderRunner(
  bytes: () => Buffer,
): AudioRenderRunner & { calls: number } {
  const r = (async ({ outPath }: { outPath: string }) => {
    r.calls += 1
    const b = bytes()
    writeFileSync(outPath, b)
    return { byteSize: b.byteLength, durationSec: 1 }
  }) as unknown as AudioRenderRunner & { calls: number }
  r.calls = 0
  return r
}

/** A render runner that always rejects with `message`, counting its calls. */
function failingRenderRunner(
  message: string,
): AudioRenderRunner & { calls: number } {
  const r = (async () => {
    r.calls += 1
    throw new Error(message)
  }) as unknown as AudioRenderRunner & { calls: number }
  r.calls = 0
  return r
}

/** Scratch PCM copies live in the OS temp dir, named `peaks-scratch-<hex>.wav`. */
function scratchLeftoverCount(): number {
  return readdirSync(tmpdir()).filter((f) => f.startsWith('peaks-scratch-'))
    .length
}

describe('a plain Sound whose Original is not WAV/AIFF still gets a computed waveform', () => {
  it('renders a scratch PCM copy for a FLAC Original, decodes peaks from it, and never renders a WAV', async () => {
    const before = scratchLeftoverCount()
    const render = spyWavRenderRunner(() => makeWav(20000))
    const tc = await makeTestCore({
      gateway: makeFakeGateway({ downloadBytes: () => makeWav(20000) }),
      computePeaksRunner: countingRunner(),
      audioRenderRunner: render,
    })
    cleanups.push(() => tc.core.close())
    await tc.core.signIn()
    tc.core.grantStagingConsent()

    const page = await tc.core.search('rain')
    const flac = page.sounds.find((s) => s.type === 'flac')!
    const wav = page.sounds.find((s) => s.type === 'wav')!

    tc.core.downloadToLibrary(flac.id)
    await waitUntil(
      () => tc.core.getStagingStatus([flac.id])[flac.id] === 'ready',
    )
    await waitUntil(() => tc.core.getPeaks(flac.id) != null)

    expect(tc.core.getPeaks(flac.id)!.bucketCount).toBeGreaterThan(0)
    expect(render.calls).toBe(1)
    expect(scratchLeftoverCount()).toBe(before)

    tc.core.downloadToLibrary(wav.id)
    await waitUntil(() => tc.core.getStagingStatus([wav.id])[wav.id] === 'ready')
    await waitUntil(() => tc.core.getPeaks(wav.id) != null)
    expect(render.calls).toBe(1)
  })

  it('a render failure that reports "not audio" writes the undecodable sentinel and is not retried', async () => {
    const before = scratchLeftoverCount()
    const render = failingRenderRunner(
      'ffmpeg exited with code 1: in.flac: Invalid data found when processing input',
    )
    const events: Array<{ soundId: number; status: string }> = []
    const tc = await makeTestCore({
      gateway: makeFakeGateway({ downloadBytes: () => makeWav(4000) }),
      computePeaksRunner: countingRunner(),
      audioRenderRunner: render,
      onPeaksStatusChange: (c) => events.push(c),
    })
    cleanups.push(() => tc.core.close())
    await tc.core.signIn()
    tc.core.grantStagingConsent()
    const page = await tc.core.search('rain')
    const flac = page.sounds.find((s) => s.type === 'flac')!

    tc.core.downloadToLibrary(flac.id)
    await waitUntil(
      () => tc.core.getStagingStatus([flac.id])[flac.id] === 'ready',
    )
    await waitUntil(() =>
      events.some((e) => e.soundId === flac.id && e.status === 'unavailable'),
    )

    const db = openTemp(tc.dbPath)
    const row = db
      .prepare('SELECT bucket_count FROM peaks WHERE sound_id = ?')
      .get(flac.id) as { bucket_count: number } | undefined
    expect(row?.bucket_count).toBe(0)

    const callsAfter = render.calls
    tc.core.requestPeaks(flac.id)
    await sleep(20)
    expect(render.calls).toBe(callsAfter)
    expect(scratchLeftoverCount()).toBe(before)
  })

  it('a transient render failure leaves the cache empty so a later visit retries', async () => {
    const render = failingRenderRunner(
      'ffmpeg exited with code 1: could not write to disk',
    )
    const events: Array<{ soundId: number; status: string }> = []
    const tc = await makeTestCore({
      gateway: makeFakeGateway({ downloadBytes: () => makeWav(4000) }),
      computePeaksRunner: countingRunner(),
      audioRenderRunner: render,
      onPeaksStatusChange: (c) => events.push(c),
    })
    cleanups.push(() => tc.core.close())
    await tc.core.signIn()
    tc.core.grantStagingConsent()
    const page = await tc.core.search('rain')
    const flac = page.sounds.find((s) => s.type === 'flac')!

    tc.core.downloadToLibrary(flac.id)
    await waitUntil(
      () => tc.core.getStagingStatus([flac.id])[flac.id] === 'ready',
    )
    await waitUntil(() =>
      events.some((e) => e.soundId === flac.id && e.status === 'unavailable'),
    )

    const db = openTemp(tc.dbPath)
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM peaks WHERE sound_id = ?').get(flac.id),
    ).toEqual({ n: 0 })

    const callsAfter = render.calls
    tc.core.requestPeaks(flac.id)
    await waitUntil(() => render.calls > callsAfter)
  })
})

describe('cached peaks are removed when the Sound is deleted or evicted', () => {
  it('deleteFromLibrary drops the peaks row with the Original', async () => {
    const wav = makeWav(4000)
    const gateway = makeFakeGateway({ downloadBytes: () => wav })
    const tc = await makeTestCore({
      gateway,
      computePeaksRunner: countingRunner(),
    })
    cleanups.push(() => tc.core.close())
    await tc.core.signIn()
    tc.core.grantStagingConsent()
    const page = await tc.core.search('rain')
    const id = page.sounds[0]!.id

    tc.core.stageOnAudition(id)
    await waitUntil(() => tc.core.getStagingStatus([id])[id] === 'ready')
    await waitUntil(() => tc.core.getPeaks(id) != null)
    tc.core.saveToLibrary(id)

    await tc.core.deleteFromLibrary(id)

    expect(tc.core.getPeaks(id)).toBeNull()
    const db = openTemp(tc.dbPath)
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM peaks WHERE sound_id = ?').get(id),
    ).toEqual({ n: 0 })
  })

  it('staging eviction drops the peaks row along with the Original + sidecar', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'peaks-evict-'))
    const dbPath = join(dataDir, 'db.sqlite')
    const db = openTemp(dbPath)

    const keep = fakeSound(1001)
    const drop = fakeSound(1002)
    for (const s of [keep, drop]) {
      upsertSound(db, s)
      const { byteSize, paths } = await writeOriginal(
        dataDir,
        s,
        makeWav(2000),
        Date.now(),
      )
      upsertStagedEntry(db, {
        soundId: s.id,
        byteSize,
        path: paths.original,
        now: s.id, // older `last_access_at` for `drop`? both tiny; set explicitly below
      })
      putPeaksRecord(db, {
        soundId: s.id,
        sampleRate: 8000,
        bucketCount: 2,
        data: Buffer.from(new Int16Array([-1, 1, -1, 1]).buffer),
      })
    }
    db.prepare(
      'UPDATE staged_entries SET last_access_at = ? WHERE sound_id = ?',
    ).run(1, drop.id)
    db.prepare(
      'UPDATE staged_entries SET last_access_at = ? WHERE sound_id = ?',
    ).run(999, keep.id)

    const outcome = await evictStagedOverBudget(
      db,
      dataDir,
      1, // 1-byte budget → evict until only protected/So remain
      createDragRegistry(),
    )
    expect(outcome.evicted).toContain(drop.id)

    expect(getPeaksRecord(db, drop.id)).toBeUndefined()
    expect(existsSync(join(dataDir, 'content', `${drop.id}.wav`))).toBe(false)
  })
})

describe('a Sound with no downloaded Original has no computed peaks', () => {
  it('getPeaks is null and requestPeaks reports unavailable — the renderer keeps the Freesound image', async () => {
    const events: Array<{ soundId: number; status: string }> = []
    const tc = await makeTestCore({
      signedIn: true,
      computePeaksRunner: countingRunner(),
      onPeaksStatusChange: (c) => events.push(c),
    })
    cleanups.push(() => tc.core.close())
    const page = await tc.core.search('rain')
    const id = page.sounds[0]!.id

    expect(tc.core.getPeaks(id)).toBeNull()
    tc.core.requestPeaks(id)
    await waitUntil(() =>
      events.some((e) => e.soundId === id && e.status === 'unavailable'),
    )
    expect(tc.core.getPeaks(id)).toBeNull()
  })
})
