import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { EditEvent, EditSpec } from '../src/core'
import { pickEditName } from '../src/core/edits/editName'
import {
  controllableRenderRunner,
  editPath,
  editSidecarPath,
  fakeRenderRunner,
  failingRenderRunner,
  listContent,
  makeTestCore,
  originalPath,
  RAIN,
  readSidecar,
  signInAndDownload,
  slowRenderRunner,
  WHOLE_FILE_SPEC,
} from './helpers'

describe('core.createEdit — whole-file export (ticket 01)', () => {
  it('renders through the fake runner and writes the Edit file + sidecar to the content store', async () => {
    const { core, dataDir } = await makeTestCore({
      audioRenderRunner: fakeRenderRunner({ bytes: 'HELLO-EDIT' }),
    })
    await signInAndDownload(core)

    const result = await core.createEdit(RAIN.id, WHOLE_FILE_SPEC)
    expect(result).not.toBeNull()
    const editId = result!.editId
    expect(editId).toBeLessThan(0)

    const edited = editPath(dataDir, RAIN)
    expect(existsSync(edited)).toBe(true)
    expect(readFileSync(edited, 'utf8')).toBe('HELLO-EDIT')

    const sidecar = readSidecar(editSidecarPath(dataDir, RAIN.id))
    expect(sidecar.derivedFrom).toBe(RAIN.id)
    expect(sidecar.editSpec).toEqual(WHOLE_FILE_SPEC)
    expect(sidecar.sound.id).toBe(editId)
  })

  it('writes a negative-id sounds row + library_entries row inheriting the parent License/author/URL', async () => {
    const { core } = await makeTestCore({
      audioRenderRunner: fakeRenderRunner(),
    })
    await signInAndDownload(core)

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
      audioRenderRunner: fakeRenderRunner(),
    })
    await signInAndDownload(core)

    const first = (await core.createEdit(RAIN.id, WHOLE_FILE_SPEC))!
    const second = (await core.createEdit(RAIN.id, WHOLE_FILE_SPEC))!
    expect(first.editId).not.toBe(second.editId)

    const lib = core.listLibrary()
    expect(lib.find((s) => s.id === first.editId)!.effectiveName).toBe('edited')
    expect(lib.find((s) => s.id === second.editId)!.effectiveName).toBe(
      'edited (2)',
    )
  })

  it('the Edit shows in listLibrary/filterLibrary, and a format filter matches it', async () => {
    const { core } = await makeTestCore({
      audioRenderRunner: fakeRenderRunner(),
    })
    await signInAndDownload(core)

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
      audioRenderRunner: fakeRenderRunner(),
    })
    await signInAndDownload(core)

    const { editId } = (await core.createEdit(RAIN.id, WHOLE_FILE_SPEC))!
    const edited = editPath(dataDir, RAIN)
    const parentPath = originalPath(dataDir, RAIN)
    expect(existsSync(edited)).toBe(true)
    expect(existsSync(parentPath)).toBe(true)

    await core.deleteFromLibrary(editId)

    expect(existsSync(edited)).toBe(false)
    expect(existsSync(editSidecarPath(dataDir, RAIN.id))).toBe(false)
    expect(core.listLibrary().some((s) => s.id === editId)).toBe(false)

    expect(existsSync(parentPath)).toBe(true)
    expect(core.listLibrary().some((s) => s.id === RAIN.id)).toBe(true)
  })

  it('setCustomName / setLibraryTags / getContentPath / getFreesoundUrl accept a negative Edit id', async () => {
    const { core, dataDir } = await makeTestCore({
      audioRenderRunner: fakeRenderRunner(),
    })
    await signInAndDownload(core)
    const parentUrl = core.getFreesoundUrl(RAIN.id)

    const { editId } = (await core.createEdit(RAIN.id, WHOLE_FILE_SPEC))!

    core.setCustomName(editId, 'My Trim')
    core.setLibraryTags(editId, ['a', 'b'])
    const edit = core.listLibrary().find((s) => s.id === editId)!
    expect(edit.effectiveName).toBe('My Trim')
    expect(edit.customTags).toEqual(['a', 'b'])

    expect(core.getContentPath(editId)).toBe(editPath(dataDir, RAIN))
    expect(core.getFreesoundUrl(editId)).toBe(parentUrl)
  })

  it('never calls the gateway and getDownloadsInLast24h is unchanged', async () => {
    const { core, gateway } = await makeTestCore({
      audioRenderRunner: fakeRenderRunner(),
    })
    await signInAndDownload(core)

    const before = core.getDownloadsInLast24h()
    const callsBefore = gateway.downloadCallCount

    await core.createEdit(RAIN.id, WHOLE_FILE_SPEC)

    expect(gateway.downloadCallCount).toBe(callsBefore)
    expect(core.getDownloadsInLast24h()).toBe(before)
  })

  it('is a silent no-op for an unknown parent or one whose Original is not on disk', async () => {
    const { core } = await makeTestCore({
      audioRenderRunner: fakeRenderRunner(),
    })
    await core.signIn()

    expect(await core.createEdit(999999, WHOLE_FILE_SPEC)).toBeNull()

    const results = await core.search('thunder')
    if (results.sounds.length > 0) {
      expect(
        await core.createEdit(results.sounds[0].id, WHOLE_FILE_SPEC),
      ).toBeNull()
    }
  })

  it('reports render progress and a final failure through subscribeEditProgress; a failure rejects and leaves nothing behind', async () => {
    const { core, dataDir } = await makeTestCore({
      audioRenderRunner: failingRenderRunner('boom'),
    })
    await signInAndDownload(core)

    const events: EditEvent[] = []
    const unsub = core.subscribeEditProgress((e) => events.push(e))

    await expect(core.createEdit(RAIN.id, WHOLE_FILE_SPEC)).rejects.toThrow(
      'boom',
    )
    expect(events.some((e) => e.status === 'failed')).toBe(true)

    expect(listContent(dataDir).filter((f) => f.includes('-edited'))).toEqual(
      [],
    )
    expect(core.listLibrary().some((s) => s.derivedFrom === RAIN.id)).toBe(
      false,
    )
    unsub()
  })

  it('emits increasing progress for a slow render and still lands a complete Edit', async () => {
    const { core } = await makeTestCore({
      audioRenderRunner: slowRenderRunner([0.25, 0.5, 0.75, 1]),
    })
    await signInAndDownload(core)

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
    const { runner, release } = controllableRenderRunner()
    const { core, dataDir } = await makeTestCore({ audioRenderRunner: runner })
    await signInAndDownload(core)

    const pending = core.createEdit(RAIN.id, WHOLE_FILE_SPEC)
    core.cancelEdit(RAIN.id)
    const result = await pending
    expect(result).toBeNull()

    release()

    expect(listContent(dataDir).filter((f) => f.includes('-edited'))).toEqual(
      [],
    )
    expect(core.listLibrary().some((s) => s.derivedFrom === RAIN.id)).toBe(
      false,
    )
  })
})

describe('core.createEdit — honouring the full EditSpec (ticket 02)', () => {
  it("passes the caller's trim/format/rate/channels/normalise through to the runner, and a trimmed Edit reports the shorter duration", async () => {
    const runner = fakeRenderRunner({
      bytes: 'TRIMMED-BYTES',
      durationSec: (spec) =>
        spec.trim ? spec.trim.endSec - spec.trim.startSec : RAIN.durationSec,
    })
    const { core } = await makeTestCore({ audioRenderRunner: runner })
    await signInAndDownload(core)

    const spec: EditSpec = {
      trim: { startSec: 2, endSec: 7 },
      format: 'mp3',
      sampleRate: 44100,
      channels: 1,
      normalize: true,
    }
    const result = await core.createEdit(RAIN.id, spec)
    expect(result).not.toBeNull()

    expect(runner.specs).toEqual([spec])

    const edit = core.listLibrary().find((s) => s.id === result!.editId)!
    expect(edit.duration).toBe(5)
    expect(edit.type).toBe('mp3')
    expect(edit.samplerate).toBe(44100)
    expect(edit.channels).toBe(1)
    expect(edit.editSpec).toEqual(spec)
  })

  it('clamps a trim window that overruns the source and rejects a zero-or-negative-length region before any render starts', async () => {
    const runner = fakeRenderRunner({ bytes: 'X', durationSec: 1 })
    const { core } = await makeTestCore({ audioRenderRunner: runner })
    await signInAndDownload(core)

    const overrun: EditSpec = {
      trim: { startSec: 30, endSec: 1000 },
      format: 'wav',
    }
    await core.createEdit(RAIN.id, overrun)
    expect(runner.calls).toBe(1)
    expect(runner.specs[0]!.trim).toEqual({
      startSec: 30,
      endSec: RAIN.durationSec,
    })

    await expect(
      core.createEdit(RAIN.id, {
        trim: { startSec: 40, endSec: 41 },
        format: 'wav',
      }),
    ).rejects.toThrow()
    expect(runner.calls).toBe(1)
  })

  it('still permits exporting the whole file with no format change', async () => {
    const { core } = await makeTestCore({
      audioRenderRunner: fakeRenderRunner(),
    })
    await signInAndDownload(core)

    const result = await core.createEdit(RAIN.id, {
      trim: null,
      format: 'wav',
    })
    expect(result).not.toBeNull()
  })
})

describe('core.createEdit — exporting an Edit of an Edit (ticket 08 regression)', () => {
  it("renders from the FIRST Edit's own file, not the `<id>.<ext>` content-store path a negative id has no file at", async () => {
    const runner = fakeRenderRunner({
      bytes: (input) => `bytes-for-${input.spec.format}`,
    })
    const { core, dataDir } = await makeTestCore({ audioRenderRunner: runner })
    await signInAndDownload(core)

    const first = await core.createEdit(RAIN.id, WHOLE_FILE_SPEC)
    expect(first).not.toBeNull()

    const second = await core.createEdit(first!.editId, WHOLE_FILE_SPEC)
    expect(second).not.toBeNull()
    expect(second!.editId).toBeLessThan(first!.editId)

    expect(runner.sourcePaths).toHaveLength(2)
    expect(runner.sourcePaths[1]).toBe(editPath(dataDir, RAIN))

    const edit = core.listLibrary().find((s) => s.id === second!.editId)
    expect(edit?.derivedFrom).toBe(first!.editId)
  })

  it('resolves null (a silent no-op) when the Edit being re-exported has no file left on disk', async () => {
    const { core } = await makeTestCore({
      audioRenderRunner: fakeRenderRunner(),
    })
    await signInAndDownload(core)

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
    expect(pickEditName(['edited (2)'])).toBe('edited')
    expect(pickEditName(['edited', 'edited (3)'])).toBe('edited (2)')
  })
})
