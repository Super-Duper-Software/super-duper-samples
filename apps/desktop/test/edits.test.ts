// Ticket 01 — export a Library Sound as an Edit, at the core seam. No
// Electron: a fake `audioRenderRunner` injected alongside the fake gateway /
// auth, a real temp SQLite database and a real temp filesystem (spec 0002 §
// Testing Decisions). This ticket is the whole-file, single-format path — no
// trim, no re-encode — so every spec below carries `trim: null`.

import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AudioRenderRunner, EditEvent, EditSpec } from '../src/core'
import type { Sidecar } from '../src/core/staging/contentStore'
import { pickEditName } from '../src/core/edits/editName'
import { makeFakeGateway, makeTestCore } from './helpers/makeTestCore'

const RAIN = { id: 321967, ext: 'wav' }
const WHOLE_FILE_SPEC: EditSpec = { trim: null, format: 'wav' }

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

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

async function waitUntil(pred: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('waitUntil timed out')
    await sleep(5)
  }
}

/** A fast, deterministic runner: copies fixed bytes to `outPath`. */
function fakeRunner(opts: { bytes?: string; durationSec?: number } = {}): AudioRenderRunner {
  const bytes = opts.bytes ?? 'FAKE-EDIT-BYTES'
  return async ({ outPath }) => {
    await writeFile(outPath, bytes)
    return { byteSize: Buffer.byteLength(bytes), durationSec: opts.durationSec ?? 3 }
  }
}

/** A runner that reports progress across a few ticks before finishing. */
function slowFakeRunner(steps: number[]): AudioRenderRunner {
  return async ({ outPath, onProgress }) => {
    for (const p of steps) {
      onProgress?.(p)
      await sleep(5)
    }
    await writeFile(outPath, 'SLOW-BYTES')
    return { byteSize: 10, durationSec: 5 }
  }
}

/** A runner that always fails (unreadable source / encode error). */
function failingRunner(message = 'encode error'): AudioRenderRunner {
  return async () => {
    throw new Error(message)
  }
}

/** A runner that waits until `release()` is called, honouring abort in the meantime. */
function controllableRunner(): { runner: AudioRenderRunner; release: () => void } {
  let release!: () => void
  const gate = new Promise<void>((res) => {
    release = res
  })
  const runner: AudioRenderRunner = async ({ outPath, signal }) => {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(abortError())
        return
      }
      const onAbort = () => reject(abortError())
      signal.addEventListener('abort', onAbort, { once: true })
      gate.then(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      })
    })
    await writeFile(outPath, 'RELEASED-BYTES')
    return { byteSize: 14, durationSec: 2 }
  }
  return { runner, release }
}

function abortError(): Error {
  const e = new Error('aborted')
  e.name = 'AbortError'
  return e
}

/** Bring the RAIN parent's Original onto disk via a real (fake-gateway) stage + save. */
async function stageParent(core: Awaited<ReturnType<typeof makeTestCore>>['core']) {
  await core.signIn()
  await core.search('rain') // seeds the `sounds` row `downloadToLibrary` needs
  core.downloadToLibrary(RAIN.id)
  await waitUntil(() => core.getStagingStatus([RAIN.id])[RAIN.id] === 'ready')
}

describe('core.createEdit — whole-file export (ticket 01)', () => {
  it('renders through the fake runner and writes the Edit file + sidecar to the content store', async () => {
    const { core, dataDir } = await makeTestCore({
      gateway: makeFakeGateway(),
      audioRenderRunner: fakeRunner({ bytes: 'HELLO-EDIT' }),
    })
    cleanups.push(() => core.close())
    await stageParent(core)

    const result = await core.createEdit(RAIN.id, WHOLE_FILE_SPEC)
    expect(result).not.toBeNull()
    const editId = result!.editId
    expect(editId).toBeLessThan(0)

    const original = join(dataDir, 'content', `${RAIN.id}-edited.${RAIN.ext}`)
    const sidecarPath = join(dataDir, 'content', `${RAIN.id}-edited.json`)
    expect(existsSync(original)).toBe(true)
    expect(existsSync(sidecarPath)).toBe(true)
    expect(readFileSync(original, 'utf8')).toBe('HELLO-EDIT')

    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')) as Sidecar
    expect(sidecar.derivedFrom).toBe(RAIN.id)
    expect(sidecar.editSpec).toEqual(WHOLE_FILE_SPEC)
    expect(sidecar.sound.id).toBe(editId)
  })

  it('writes a negative-id sounds row + library_entries row inheriting the parent License/author/URL', async () => {
    const { core } = await makeTestCore({
      gateway: makeFakeGateway(),
      audioRenderRunner: fakeRunner(),
    })
    cleanups.push(() => core.close())
    await stageParent(core)

    const parent = core.listLibrary().find((s) => s.id === RAIN.id)!
    const { editId } = (await core.createEdit(RAIN.id, WHOLE_FILE_SPEC))!

    const lib = core.listLibrary()
    const edit = lib.find((s) => s.id === editId)
    expect(edit).toBeDefined()
    expect(edit!.license).toEqual(parent.license)
    expect(edit!.username).toBe(parent.username)
    expect(edit!.url).toBe(parent.url)
    expect(edit!.derivedFrom).toBe(RAIN.id)
    expect(edit!.editSpec).toEqual(WHOLE_FILE_SPEC)
    expect(edit!.effectiveName).toBe('edited')
  })

  it('a second Edit of the same parent is named "edited (2)"', async () => {
    const { core } = await makeTestCore({
      gateway: makeFakeGateway(),
      audioRenderRunner: fakeRunner(),
    })
    cleanups.push(() => core.close())
    await stageParent(core)

    const first = (await core.createEdit(RAIN.id, WHOLE_FILE_SPEC))!
    const second = (await core.createEdit(RAIN.id, WHOLE_FILE_SPEC))!
    expect(first.editId).not.toBe(second.editId)

    const lib = core.listLibrary()
    expect(lib.find((s) => s.id === first.editId)!.effectiveName).toBe('edited')
    expect(lib.find((s) => s.id === second.editId)!.effectiveName).toBe('edited (2)')
  })

  it('the Edit shows in listLibrary/filterLibrary, and a format filter matches it', async () => {
    const { core } = await makeTestCore({
      gateway: makeFakeGateway(),
      audioRenderRunner: fakeRunner(),
    })
    cleanups.push(() => core.close())
    await stageParent(core)

    const { editId } = (await core.createEdit(RAIN.id, WHOLE_FILE_SPEC))!
    expect(core.listLibrary().some((s) => s.id === editId)).toBe(true)
    expect(
      core.filterLibrary({ fileType: 'wav' }).some((s) => s.id === editId),
    ).toBe(true)
    expect(
      core.filterLibrary({ fileType: 'mp3' }).some((s) => s.id === editId),
    ).toBe(false)
  })

  it('deleteFromLibrary removes the Edit row + file and leaves the parent Sound + Original untouched', async () => {
    const { core, dataDir } = await makeTestCore({
      gateway: makeFakeGateway(),
      audioRenderRunner: fakeRunner(),
    })
    cleanups.push(() => core.close())
    await stageParent(core)

    const { editId } = (await core.createEdit(RAIN.id, WHOLE_FILE_SPEC))!
    const editPath = join(dataDir, 'content', `${RAIN.id}-edited.${RAIN.ext}`)
    const parentPath = join(dataDir, 'content', `${RAIN.id}.${RAIN.ext}`)
    expect(existsSync(editPath)).toBe(true)
    expect(existsSync(parentPath)).toBe(true)

    await core.deleteFromLibrary(editId)

    expect(existsSync(editPath)).toBe(false)
    expect(existsSync(join(dataDir, 'content', `${RAIN.id}-edited.json`))).toBe(false)
    expect(core.listLibrary().some((s) => s.id === editId)).toBe(false)

    // The parent survives, file and all.
    expect(existsSync(parentPath)).toBe(true)
    expect(core.listLibrary().some((s) => s.id === RAIN.id)).toBe(true)
  })

  it('setCustomName / setLibraryTags / getContentPath / getFreesoundUrl accept a negative Edit id', async () => {
    const { core, dataDir } = await makeTestCore({
      gateway: makeFakeGateway(),
      audioRenderRunner: fakeRunner(),
    })
    cleanups.push(() => core.close())
    await stageParent(core)
    const parentUrl = core.getFreesoundUrl(RAIN.id)

    const { editId } = (await core.createEdit(RAIN.id, WHOLE_FILE_SPEC))!

    core.setCustomName(editId, 'My Trim')
    core.setLibraryTags(editId, ['a', 'b'])
    const edit = core.listLibrary().find((s) => s.id === editId)!
    expect(edit.effectiveName).toBe('My Trim')
    expect(edit.customTags).toEqual(['a', 'b'])

    expect(core.getContentPath(editId)).toBe(
      join(dataDir, 'content', `${RAIN.id}-edited.${RAIN.ext}`),
    )
    // openFreesoundPage opens the PARENT's page.
    expect(core.getFreesoundUrl(editId)).toBe(parentUrl)
  })

  it('never calls the gateway and getDownloadsInLast24h is unchanged', async () => {
    const gateway = makeFakeGateway()
    const { core } = await makeTestCore({ gateway, audioRenderRunner: fakeRunner() })
    cleanups.push(() => core.close())
    await stageParent(core)

    const before = core.getDownloadsInLast24h()
    const callsBefore = gateway.downloadCallCount

    await core.createEdit(RAIN.id, WHOLE_FILE_SPEC)

    expect(gateway.downloadCallCount).toBe(callsBefore)
    expect(core.getDownloadsInLast24h()).toBe(before)
  })

  it('is a silent no-op for an unknown parent or one whose Original is not on disk', async () => {
    const { core } = await makeTestCore({
      gateway: makeFakeGateway(),
      audioRenderRunner: fakeRunner(),
    })
    cleanups.push(() => core.close())
    await core.signIn()

    expect(await core.createEdit(999999, WHOLE_FILE_SPEC)).toBeNull()

    // A Sound the core has metadata for (via search) but never downloaded.
    const results = await core.search('thunder')
    if (results.sounds.length > 0) {
      expect(await core.createEdit(results.sounds[0].id, WHOLE_FILE_SPEC)).toBeNull()
    }
  })

  it('reports render progress and a final failure through subscribeEditProgress; a failure rejects and leaves nothing behind', async () => {
    const { core, dataDir } = await makeTestCore({
      gateway: makeFakeGateway(),
      audioRenderRunner: failingRunner('boom'),
    })
    cleanups.push(() => core.close())
    await stageParent(core)

    const events: EditEvent[] = []
    const unsub = core.subscribeEditProgress((e) => events.push(e))

    await expect(core.createEdit(RAIN.id, WHOLE_FILE_SPEC)).rejects.toThrow('boom')
    expect(events.some((e) => e.status === 'failed')).toBe(true)

    // Nothing was written: only the parent's own file exists in the content dir.
    const { readdirSync } = await import('node:fs')
    const files = readdirSync(join(dataDir, 'content'))
    expect(files.filter((f) => f.includes('-edited'))).toHaveLength(0)
    expect(core.listLibrary().some((s) => s.derivedFrom === RAIN.id)).toBe(false)
    unsub()
  })

  it('emits increasing progress for a slow render and still lands a complete Edit', async () => {
    const { core } = await makeTestCore({
      gateway: makeFakeGateway(),
      audioRenderRunner: slowFakeRunner([0.25, 0.5, 0.75, 1]),
    })
    cleanups.push(() => core.close())
    await stageParent(core)

    const progress: number[] = []
    const unsub = core.subscribeEditProgress((e) => {
      if (e.status === 'progress') progress.push(e.progress)
    })

    const result = await core.createEdit(RAIN.id, WHOLE_FILE_SPEC)
    expect(result).not.toBeNull()
    expect(progress).toEqual([0.25, 0.5, 0.75, 1])
    unsub()
  })

  it('cancelEdit during a render leaves no row, no file and no sidecar behind', async () => {
    const { runner, release } = controllableRunner()
    const { core, dataDir } = await makeTestCore({
      gateway: makeFakeGateway(),
      audioRenderRunner: runner,
    })
    cleanups.push(() => core.close())
    await stageParent(core)

    const pending = core.createEdit(RAIN.id, WHOLE_FILE_SPEC)
    core.cancelEdit(RAIN.id)
    const result = await pending
    expect(result).toBeNull()

    release() // let the (already-aborted) runner unwind

    const { readdirSync } = await import('node:fs')
    const files = readdirSync(join(dataDir, 'content'))
    expect(files.filter((f) => f.includes('-edited'))).toHaveLength(0)
    expect(core.listLibrary().some((s) => s.derivedFrom === RAIN.id)).toBe(false)
  })
})

describe('core.createEdit — honouring the full EditSpec (ticket 02)', () => {
  it('passes the caller\'s trim/format/rate/channels/normalise through to the runner, and a trimmed Edit reports the shorter duration', async () => {
    const seen: EditSpec[] = []
    const recordingRunner: AudioRenderRunner = async ({ spec, outPath }) => {
      seen.push(spec)
      await writeFile(outPath, 'TRIMMED-BYTES')
      const [durationSec] = [spec.trim ? spec.trim.endSec - spec.trim.startSec : 34.7208]
      return { byteSize: 13, durationSec }
    }
    const { core } = await makeTestCore({
      gateway: makeFakeGateway(),
      audioRenderRunner: recordingRunner,
    })
    cleanups.push(() => core.close())
    await stageParent(core)

    const spec: EditSpec = {
      trim: { startSec: 2, endSec: 7 },
      format: 'mp3',
      sampleRate: 44100,
      channels: 1,
      normalize: true,
    }
    const result = await core.createEdit(RAIN.id, spec)
    expect(result).not.toBeNull()

    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual(spec)

    const edit = core.listLibrary().find((s) => s.id === result!.editId)!
    expect(edit.duration).toBe(5)
    expect(edit.type).toBe('mp3')
    expect(edit.samplerate).toBe(44100)
    expect(edit.channels).toBe(1)
    expect(edit.editSpec).toEqual(spec)
  })

  it('clamps a trim window that overruns the source and rejects a zero-or-negative-length region before any render starts', async () => {
    const calls: EditSpec[] = []
    const recordingRunner: AudioRenderRunner = async ({ spec, outPath }) => {
      calls.push(spec)
      await writeFile(outPath, 'X')
      return { byteSize: 1, durationSec: 1 }
    }
    const { core } = await makeTestCore({
      gateway: makeFakeGateway(),
      audioRenderRunner: recordingRunner,
    })
    cleanups.push(() => core.close())
    await stageParent(core)

    // Overruns the source's 34.7208s duration — clamped, not rejected.
    const overrun: EditSpec = { trim: { startSec: 30, endSec: 1000 }, format: 'wav' }
    await core.createEdit(RAIN.id, overrun)
    expect(calls).toHaveLength(1)
    expect(calls[0].trim).toEqual({ startSec: 30, endSec: 34.7208 })

    // Zero-length after clamping — rejected before the runner ever runs.
    await expect(
      core.createEdit(RAIN.id, { trim: { startSec: 40, endSec: 41 }, format: 'wav' }),
    ).rejects.toThrow()
    expect(calls).toHaveLength(1) // the runner was never called a second time
  })

  it('still permits exporting the whole file with no format change', async () => {
    const { core } = await makeTestCore({
      gateway: makeFakeGateway(),
      audioRenderRunner: fakeRunner(),
    })
    cleanups.push(() => core.close())
    await stageParent(core)

    const result = await core.createEdit(RAIN.id, { trim: null, format: 'wav' })
    expect(result).not.toBeNull()
  })
})

describe('core.createEdit — exporting an Edit of an Edit (ticket 08 regression)', () => {
  it("renders from the FIRST Edit's own file, not the `<id>.<ext>` content-store path a negative id has no file at", async () => {
    const sourcePaths: string[] = []
    const recordingRunner: AudioRenderRunner = async ({ sourcePath, outPath }) => {
      sourcePaths.push(sourcePath)
      await writeFile(outPath, `bytes-for-${sourcePaths.length}`)
      return { byteSize: 1, durationSec: 3 }
    }
    const { core, dataDir } = await makeTestCore({
      gateway: makeFakeGateway(),
      audioRenderRunner: recordingRunner,
    })
    cleanups.push(() => core.close())
    await stageParent(core)

    const first = await core.createEdit(RAIN.id, WHOLE_FILE_SPEC)
    expect(first).not.toBeNull()

    // Exporting the first Edit itself — this used to resolve `null` (a silent
    // no-op) because `isOriginalOnDisk`/`contentPaths` assumed every parent's
    // file lives at `<id>.<ext>`, which is never true for a negative-id Edit.
    const second = await core.createEdit(first!.editId, WHOLE_FILE_SPEC)
    expect(second).not.toBeNull()
    expect(second!.editId).toBeLessThan(first!.editId) // a more-negative id

    expect(sourcePaths).toHaveLength(2)
    expect(sourcePaths[1]).toBe(
      join(dataDir, 'content', `${RAIN.id}-edited.${RAIN.ext}`),
    )

    const edit = core.listLibrary().find((s) => s.id === second!.editId)
    expect(edit?.derivedFrom).toBe(first!.editId)
  })

  it('resolves null (a silent no-op) when the Edit being re-exported has no file left on disk', async () => {
    const { core } = await makeTestCore({
      gateway: makeFakeGateway(),
      audioRenderRunner: fakeRunner(),
    })
    cleanups.push(() => core.close())
    await stageParent(core)

    const first = await core.createEdit(RAIN.id, WHOLE_FILE_SPEC)
    await core.deleteFromLibrary(first!.editId)

    expect(await core.createEdit(first!.editId, WHOLE_FILE_SPEC)).toBeNull()
  })
})

describe('pickEditName (pure)', () => {
  it('picks "edited" when free, else the next free "edited (N)"', () => {
    expect(pickEditName([])).toBe('edited')
    expect(pickEditName(['edited'])).toBe('edited (2)')
    expect(pickEditName(['edited', 'edited (2)'])).toBe('edited (3)')
    expect(pickEditName(['edited (2)'])).toBe('edited') // a gap is still filled first
    expect(pickEditName(['edited', 'edited (3)'])).toBe('edited (2)') // fills the gap, not (4)
  })
})
