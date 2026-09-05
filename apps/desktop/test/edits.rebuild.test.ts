// Ticket 06 — Edits survive a Library rebuild from sidecars (ADR-0005). Builds
// on ticket 14's rebuild (see `rebuild.test.ts`): an Edit's sidecar carries
// `derivedFrom` + `editSpec`, and `rebuildFromSidecars` must recognise it and
// reconstruct a negative-id `sounds` row + `library_entries` row from it alone
// — even when the parent Sound is gone.

import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AudioRenderRunner, EditSpec } from '../src/core'
import { makeFakeGateway, makeTestCore } from './helpers/makeTestCore'

const RAIN = { id: 321967, ext: 'wav' }
const WHOLE_FILE_SPEC: EditSpec = { trim: null, format: 'wav' }
const TRIM_SPEC: EditSpec = { trim: { startSec: 0, endSec: 1 }, format: 'wav' }

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

function fakeRunner(opts: { bytes?: string; durationSec?: number } = {}): AudioRenderRunner {
  const bytes = opts.bytes ?? 'FAKE-EDIT-BYTES'
  return async ({ outPath }) => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(outPath, bytes)
    return { byteSize: Buffer.byteLength(bytes), durationSec: opts.durationSec ?? 1 }
  }
}

async function stageParent(core: Awaited<ReturnType<typeof makeTestCore>>['core']) {
  await core.signIn()
  await core.search('rain')
  core.downloadToLibrary(RAIN.id)
  await waitUntil(() => core.getStagingStatus([RAIN.id])[RAIN.id] === 'ready')
}

describe('core.rebuildFromSidecars — Edits (ticket 06)', () => {
  it('recovers an Edit after the database is deleted, with inherited License and trimmed duration', async () => {
    const tc1 = await makeTestCore({
      gateway: makeFakeGateway(),
      audioRenderRunner: fakeRunner({ durationSec: 1 }),
    })
    await stageParent(tc1.core)
    const parent = tc1.core.listLibrary().find((s) => s.id === RAIN.id)!
    const { editId } = (await tc1.core.createEdit(RAIN.id, TRIM_SPEC))!
    const editBefore = tc1.core.listLibrary().find((s) => s.id === editId)!
    expect(editBefore.duration).toBe(1)
    tc1.core.close()

    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(tc1.dbPath + suffix, { force: true })
    }

    const tc2 = await makeTestCore({ dbPath: tc1.dbPath, dataDir: tc1.dataDir })
    cleanups.push(() => tc2.core.close())
    expect(tc2.core.listLibrary()).toEqual([])

    const report = await tc2.core.rebuildFromSidecars()
    expect(report.counts.recovered).toBeGreaterThanOrEqual(1)

    const lib = tc2.core.listLibrary()
    // The id is re-minted — find the recovered Edit by its parentage, not its old id.
    const recoveredEdit = lib.find((s) => s.derivedFrom === RAIN.id)
    expect(recoveredEdit).toBeDefined()
    expect(recoveredEdit!.duration).toBe(1)
    expect(recoveredEdit!.license).toEqual(parent.license)
    expect(recoveredEdit!.username).toBe(parent.username)
    expect(recoveredEdit!.editSpec).toEqual(TRIM_SPEC)
    expect(tc2.core.getContentPath(recoveredEdit!.id)).toBe(
      join(tc1.dataDir, 'content', `${RAIN.id}-edited.wav`),
    )
  })

  it('an Edit whose parent Sound was deleted is still recovered and attributable', async () => {
    const tc1 = await makeTestCore({
      gateway: makeFakeGateway(),
      audioRenderRunner: fakeRunner(),
    })
    await stageParent(tc1.core)
    const { editId } = (await tc1.core.createEdit(RAIN.id, WHOLE_FILE_SPEC))!
    await tc1.core.deleteFromLibrary(RAIN.id) // the parent is gone; the Edit's sidecar is self-contained
    expect(tc1.core.listLibrary().find((s) => s.id === editId)).toBeDefined()
    tc1.core.close()

    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(tc1.dbPath + suffix, { force: true })
    }

    const tc2 = await makeTestCore({ dbPath: tc1.dbPath, dataDir: tc1.dataDir })
    cleanups.push(() => tc2.core.close())

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
      gateway: makeFakeGateway(),
      audioRenderRunner: fakeRunner(),
    })
    await stageParent(tc1.core)
    await tc1.core.createEdit(RAIN.id, WHOLE_FILE_SPEC)
    tc1.core.close()

    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(tc1.dbPath + suffix, { force: true })
    }

    const tc2 = await makeTestCore({ dbPath: tc1.dbPath, dataDir: tc1.dataDir })
    cleanups.push(() => tc2.core.close())

    await tc2.core.rebuildFromSidecars()
    const second = await tc2.core.rebuildFromSidecars()
    const edits = tc2.core.listLibrary().filter((s) => s.derivedFrom === RAIN.id)
    expect(edits).toHaveLength(1)
    expect(second.counts.alreadyPresent).toBeGreaterThanOrEqual(1)
  })

  it('an Edit sidecar with no audio file is reported like an orphan sidecar for a Sound', async () => {
    const tc1 = await makeTestCore({
      gateway: makeFakeGateway(),
      audioRenderRunner: fakeRunner(),
    })
    await stageParent(tc1.core)
    await tc1.core.createEdit(RAIN.id, WHOLE_FILE_SPEC)
    tc1.core.close()

    const editAudio = join(tc1.dataDir, 'content', `${RAIN.id}-edited.wav`)
    expect(existsSync(editAudio)).toBe(true)
    rmSync(editAudio) // sidecar stays, audio gone

    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(tc1.dbPath + suffix, { force: true })
    }

    const tc2 = await makeTestCore({ dbPath: tc1.dbPath, dataDir: tc1.dataDir })
    cleanups.push(() => tc2.core.close())

    const report = await tc2.core.rebuildFromSidecars()
    const editSidecarPath = join(tc1.dataDir, 'content', `${RAIN.id}-edited.json`)
    expect(report.orphanSidecars).toContain(editSidecarPath)
    expect(report.cleanedUpSidecars).toContain(editSidecarPath)
    expect(existsSync(editSidecarPath)).toBe(false)
    expect(tc2.core.listLibrary().find((s) => s.derivedFrom === RAIN.id)).toBeUndefined()
  })

  it("an Edit's own name survives a rebuild, but its custom tags and Collection membership do not", async () => {
    const tc1 = await makeTestCore({
      gateway: makeFakeGateway(),
      audioRenderRunner: fakeRunner(),
    })
    await stageParent(tc1.core)
    const { editId } = (await tc1.core.createEdit(RAIN.id, WHOLE_FILE_SPEC))!
    tc1.core.setCustomName(editId, 'My best take')
    tc1.core.setLibraryTags(editId, ['favourite'])
    const collection = tc1.core.createCollection('Favorites')
    tc1.core.addToCollection(collection.id, [editId])
    tc1.core.close()

    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(tc1.dbPath + suffix, { force: true })
    }

    const tc2 = await makeTestCore({ dbPath: tc1.dbPath, dataDir: tc1.dataDir })
    cleanups.push(() => tc2.core.close())
    const report = await tc2.core.rebuildFromSidecars()

    const recoveredEdit = tc2.core.listLibrary().find((s) => s.derivedFrom === RAIN.id)!
    // An Edit's name is user-chosen and has no Freesound fallback (ADR-0005):
    // the sidecar mirrors it, so a rebuild brings it back — not bare `edited`.
    expect(recoveredEdit.effectiveName).toBe('My best take')
    expect(recoveredEdit.customName).toBe('My best take')
    expect(report.recovered.find((r) => r.soundId === recoveredEdit.id)?.name).toBe(
      'My best take',
    )
    // Custom tags and Collections still live only in the database.
    expect(recoveredEdit.customTags).toEqual([])
    expect(tc2.core.listCollections()).toEqual([])
  })

  it("a later rename to an Edit is mirrored into its sidecar and survives a rebuild", async () => {
    const tc1 = await makeTestCore({
      gateway: makeFakeGateway(),
      audioRenderRunner: fakeRunner(),
    })
    await stageParent(tc1.core)
    const { editId } = (await tc1.core.createEdit(RAIN.id, WHOLE_FILE_SPEC))!
    tc1.core.setCustomName(editId, 'first name')
    tc1.core.setCustomName(editId, 'renamed later')
    tc1.core.close()

    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(tc1.dbPath + suffix, { force: true })
    }

    const tc2 = await makeTestCore({ dbPath: tc1.dbPath, dataDir: tc1.dataDir })
    cleanups.push(() => tc2.core.close())
    await tc2.core.rebuildFromSidecars()

    const recoveredEdit = tc2.core.listLibrary().find((s) => s.derivedFrom === RAIN.id)!
    expect(recoveredEdit.effectiveName).toBe('renamed later')
  })
})
