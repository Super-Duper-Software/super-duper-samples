import { existsSync, rmSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { EditSpec } from '../src/core'
import {
  editPath,
  editSidecarPath,
  fakeRenderRunner,
  makeTestCore,
  RAIN,
  reopenWithoutDatabase,
  signInAndDownload,
  WHOLE_FILE_SPEC,
} from './helpers'

const TRIM_SPEC: EditSpec = { trim: { startSec: 0, endSec: 1 }, format: 'wav' }

describe('core.rebuildFromSidecars — Edits (ticket 06)', () => {
  it('recovers an Edit after the database is deleted, with inherited License and trimmed duration', async () => {
    const tc1 = await makeTestCore({
      audioRenderRunner: fakeRenderRunner({ durationSec: 1 }),
    })
    await signInAndDownload(tc1.core)
    const parent = tc1.core.listLibrary().find((s) => s.id === RAIN.id)!
    const { editId } = (await tc1.core.createEdit(RAIN.id, TRIM_SPEC))!
    const editBefore = tc1.core.listLibrary().find((s) => s.id === editId)!
    expect(editBefore.duration).toBe(1)

    const tc2 = await reopenWithoutDatabase(tc1)
    expect(tc2.core.listLibrary()).toEqual([])

    const report = await tc2.core.rebuildFromSidecars()
    expect(report.counts.recovered).toBeGreaterThanOrEqual(1)

    const lib = tc2.core.listLibrary()
    const recoveredEdit = lib.find((s) => s.derivedFrom === RAIN.id)
    expect(recoveredEdit).toBeDefined()
    expect(recoveredEdit!.duration).toBe(1)
    expect(recoveredEdit!.license).toEqual(parent.license)
    expect(recoveredEdit!.username).toBe(parent.username)
    expect(recoveredEdit!.editSpec).toEqual(TRIM_SPEC)
    expect(tc2.core.getContentPath(recoveredEdit!.id)).toBe(
      editPath(tc1.dataDir, RAIN),
    )
  })

  it('an Edit whose parent Sound was deleted is still recovered and attributable', async () => {
    const tc1 = await makeTestCore({
      audioRenderRunner: fakeRenderRunner({ durationSec: 1 }),
    })
    await signInAndDownload(tc1.core)
    const { editId } = (await tc1.core.createEdit(RAIN.id, WHOLE_FILE_SPEC))!
    await tc1.core.deleteFromLibrary(RAIN.id)
    expect(tc1.core.listLibrary().find((s) => s.id === editId)).toBeDefined()

    const tc2 = await reopenWithoutDatabase(tc1)

    const report = await tc2.core.rebuildFromSidecars()
    const lib = tc2.core.listLibrary()
    const recoveredEdit = lib.find((s) => s.derivedFrom === RAIN.id)
    expect(recoveredEdit).toBeDefined()
    expect(recoveredEdit!.username).toBeTruthy()
    expect(recoveredEdit!.license.name).toBeTruthy()
    expect(report.counts.recovered).toBeGreaterThanOrEqual(1)
  })

  it('re-running a rebuild does not duplicate a recovered Edit', async () => {
    const tc1 = await makeTestCore({
      audioRenderRunner: fakeRenderRunner({ durationSec: 1 }),
    })
    await signInAndDownload(tc1.core)
    await tc1.core.createEdit(RAIN.id, WHOLE_FILE_SPEC)

    const tc2 = await reopenWithoutDatabase(tc1)

    await tc2.core.rebuildFromSidecars()
    const second = await tc2.core.rebuildFromSidecars()
    const edits = tc2.core
      .listLibrary()
      .filter((s) => s.derivedFrom === RAIN.id)
    expect(edits).toHaveLength(1)
    expect(second.counts.alreadyPresent).toBeGreaterThanOrEqual(1)
  })

  it('an Edit sidecar with no audio file is reported like an orphan sidecar for a Sound', async () => {
    const tc1 = await makeTestCore({
      audioRenderRunner: fakeRenderRunner({ durationSec: 1 }),
    })
    await signInAndDownload(tc1.core)
    await tc1.core.createEdit(RAIN.id, WHOLE_FILE_SPEC)
    const editAudio = editPath(tc1.dataDir, RAIN)
    expect(existsSync(editAudio)).toBe(true)
    rmSync(editAudio)

    const tc2 = await reopenWithoutDatabase(tc1)

    const report = await tc2.core.rebuildFromSidecars()
    const orphan = editSidecarPath(tc1.dataDir, RAIN.id)
    expect(report.orphanSidecars).toContain(orphan)
    expect(report.cleanedUpSidecars).toContain(orphan)
    expect(existsSync(orphan)).toBe(false)
    expect(
      tc2.core.listLibrary().find((s) => s.derivedFrom === RAIN.id),
    ).toBeUndefined()
  })

  it("an Edit's own name survives a rebuild, but its custom tags and Collection membership do not", async () => {
    const tc1 = await makeTestCore({
      audioRenderRunner: fakeRenderRunner({ durationSec: 1 }),
    })
    await signInAndDownload(tc1.core)
    const { editId } = (await tc1.core.createEdit(RAIN.id, WHOLE_FILE_SPEC))!
    tc1.core.setCustomName(editId, 'My best take')
    tc1.core.setLibraryTags(editId, ['favourite'])
    const collection = tc1.core.createCollection('Favorites')
    tc1.core.addToCollection(collection.id, [editId])

    const tc2 = await reopenWithoutDatabase(tc1)
    const report = await tc2.core.rebuildFromSidecars()

    const recoveredEdit = tc2.core
      .listLibrary()
      .find((s) => s.derivedFrom === RAIN.id)!
    expect(recoveredEdit.effectiveName).toBe('My best take')
    expect(recoveredEdit.customName).toBe('My best take')
    expect(
      report.recovered.find((r) => r.soundId === recoveredEdit.id)?.name,
    ).toBe('My best take')
    expect(recoveredEdit.customTags).toEqual([])
    expect(tc2.core.listCollections()).toEqual([])
  })

  it('a later rename to an Edit is mirrored into its sidecar and survives a rebuild', async () => {
    const tc1 = await makeTestCore({
      audioRenderRunner: fakeRenderRunner({ durationSec: 1 }),
    })
    await signInAndDownload(tc1.core)
    const { editId } = (await tc1.core.createEdit(RAIN.id, WHOLE_FILE_SPEC))!
    tc1.core.setCustomName(editId, 'first name')
    tc1.core.setCustomName(editId, 'renamed later')

    const tc2 = await reopenWithoutDatabase(tc1)
    await tc2.core.rebuildFromSidecars()

    const recoveredEdit = tc2.core
      .listLibrary()
      .find((s) => s.derivedFrom === RAIN.id)!
    expect(recoveredEdit.effectiveName).toBe('renamed later')
  })
})
