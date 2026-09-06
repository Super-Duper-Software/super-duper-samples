import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OriginalNotStagedError } from '../src/core'
import { upsertSound } from '../src/core/db/sounds'
import {
  controllableRenderRunner,
  dragCore,
  editPath,
  fakeRenderRunner,
  fakeSound,
  openTempDb,
  originalBytes,
  originalPath,
  RAIN,
  seedSoundRow,
  sidecarPath,
  signedInCore,
  stageReady,
  WHOLE_FILE_SPEC,
} from './helpers'

/** A crafted Sound on disk, cloned from the RAIN fixture's shape. */
const crafted = (id: number, name: string) => fakeSound(id, { name })

describe('core.startDrag — the OS hand-off', () => {
  it('drags a hardlinked, human-named Original — not the store path, not a Preview', async () => {
    const { core, host, dataDir } = await dragCore()
    await stageReady(core, RAIN.id)

    const res = core.startDrag(RAIN.id)

    expect(host.drags).toHaveLength(1)
    expect(host.last!.filePath).toBe(res.filePath)
    expect(res.soundIds).toEqual([RAIN.id])
    expect(res.extraFilePaths).toEqual([])

    const name = basename(res.filePath)
    expect(name).not.toBe(`${RAIN.id}.${RAIN.ext}`)
    expect(name).toMatch(/rain/i)
    expect(name.endsWith('.wav')).toBe(true)

    expect(res.filePath.startsWith(join(dataDir, 'drag'))).toBe(true)
    expect(res.filePath).not.toMatch(/^https?:/)
    expect(res.filePath.toLowerCase()).not.toContain('preview')

    const storePath = originalPath(dataDir, RAIN)
    expect(statSync(res.filePath).ino).toBe(statSync(storePath).ino)
    expect(statSync(res.filePath).nlink).toBeGreaterThanOrEqual(2)

    expect(readFileSync(res.filePath, 'utf8')).toBe(originalBytes(RAIN.id))

    expect(host.last!.iconPath).toBeTruthy()
    expect(existsSync(host.last!.iconPath)).toBe(true)
  })

  it('the dropped file still resolves after the app quits and the staged Original is evicted', async () => {
    const { core, dataDir, dbPath } = await dragCore()
    await stageReady(core, RAIN.id)
    const res = core.startDrag(RAIN.id)

    const storePath = originalPath(dataDir, RAIN)
    rmSync(storePath)
    rmSync(sidecarPath(dataDir, RAIN.id))
    openTempDb(dbPath)
      .prepare('DELETE FROM staged_entries WHERE sound_id = ?')
      .run(RAIN.id)

    expect(existsSync(storePath)).toBe(false)
    expect(readFileSync(res.filePath, 'utf8')).toBe(originalBytes(RAIN.id))
  })

  it('re-dragging the same Sound reuses the same hardlink (idempotent)', async () => {
    const { core } = await dragCore()
    await stageReady(core, RAIN.id)

    const a = core.startDrag(RAIN.id)
    const b = core.startDrag(RAIN.id)
    expect(b.filePath).toBe(a.filePath)
  })
})

describe('core.startDrag — refusing an unstaged Sound', () => {
  it('refuses with a visible explanation — never a Preview, never a silent no-op', async () => {
    const { core, host, dataDir } = await dragCore()

    expect(() => core.startDrag(RAIN.id)).toThrow(OriginalNotStagedError)

    let msg = ''
    try {
      core.startDrag(RAIN.id)
    } catch (err) {
      msg = (err as Error).message
    }
    expect(msg).toMatch(/a Preview is never dragged/i)
    expect(msg).toContain('Rain_Heavy_Loop')

    expect(host.drags).toHaveLength(0)
    expect(existsSync(join(dataDir, 'drag'))).toBe(false)
  })

  it('refuses the whole multi-Sound drag if any one Sound is not staged', async () => {
    const { core, host, dataDir, dbPath } = await dragCore({
      multiFileDragSupported: true,
    })
    const db = openTempDb(dbPath)
    await seedSoundRow(db, dataDir, crafted(8001, 'Thunder clap'))
    upsertSound(db, crafted(8002, 'Rain hiss'))

    expect(() => core.startDrag([8001, 8002])).toThrow(OriginalNotStagedError)
    expect(host.drags).toHaveLength(0)
  })
})

describe('core.startDrag — filename collisions', () => {
  it('two Sounds that sanitise to the same name arrive as distinct files', async () => {
    const { core, dataDir, dbPath } = await dragCore()
    const db = openTempDb(dbPath)
    await seedSoundRow(db, dataDir, crafted(9001, 'Ocean: waves'))
    await seedSoundRow(db, dataDir, crafted(9002, 'Ocean/waves'))

    const r1 = core.startDrag(9001)
    const r2 = core.startDrag(9002)

    expect(basename(r1.filePath)).toBe('Ocean waves.wav')
    expect(basename(r2.filePath)).toBe('Ocean waves (2).wav')
    expect(r1.filePath).not.toBe(r2.filePath)
    expect(existsSync(r1.filePath) && existsSync(r2.filePath)).toBe(true)

    expect(readFileSync(r1.filePath, 'utf8')).toBe('ORIG-9001')
    expect(readFileSync(r2.filePath, 'utf8')).toBe('ORIG-9002')
  })
})

describe('core.startDrag — multi-Sound gating (ticket 01)', () => {
  it('links every Sound where ticket 01 verified multi-file delivery', async () => {
    const { core, host, dataDir, dbPath } = await dragCore({
      multiFileDragSupported: true,
    })
    const db = openTempDb(dbPath)
    await seedSoundRow(db, dataDir, crafted(8001, 'Thunder clap'))
    await seedSoundRow(db, dataDir, crafted(8002, 'Rain hiss'))

    const res = core.startDrag([8001, 8002])

    expect(core.getDragCapabilities().multiSound).toBe(true)
    expect(res.soundIds).toEqual([8001, 8002])
    expect(res.extraFilePaths).toHaveLength(1)
    expect(basename(host.last!.filePath)).toBe('Thunder clap.wav')
    expect(basename(host.last!.extraFilePaths[0]!)).toBe('Rain hiss.wav')
    expect(readFileSync(res.filePath, 'utf8')).toBe('ORIG-8001')
    expect(readFileSync(res.extraFilePaths[0]!, 'utf8')).toBe('ORIG-8002')
  })

  it('drags only the first Sound where ticket 01 did not verify it', async () => {
    const { core, host, dataDir, dbPath } = await dragCore({
      multiFileDragSupported: false,
    })
    const db = openTempDb(dbPath)
    await seedSoundRow(db, dataDir, crafted(8001, 'Thunder clap'))
    await seedSoundRow(db, dataDir, crafted(8002, 'Rain hiss'))

    const res = core.startDrag([8001, 8002])

    expect(core.getDragCapabilities().multiSound).toBe(false)
    expect(res.soundIds).toEqual([8001])
    expect(res.extraFilePaths).toEqual([])
    expect(host.last!.extraFilePaths).toEqual([])
  })
})

describe('core.startDrag — not configured', () => {
  it('throws a clear error when the core has no DragHost', async () => {
    const tc = await signedInCore()
    await tc.core.search('rain')
    await stageReady(tc.core, RAIN.id)

    expect(tc.core.getDragCapabilities().multiSound).toBe(false)
    expect(() => tc.core.startDrag(RAIN.id)).toThrow(/not configured/i)
  })
})

describe('core.startDrag — dragging an Edit out (ticket 04)', () => {
  it('drags an Edit as a hardlink to its OWN file under its effective name — not the content-store path', async () => {
    const { core, dataDir } = await dragCore({
      audioRenderRunner: fakeRenderRunner({ bytes: 'EDIT-BYTES' }),
    })
    await stageReady(core, RAIN.id)
    const { editId } = (await core.createEdit(RAIN.id, WHOLE_FILE_SPEC))!
    expect(editId).toBeLessThan(0)

    const res = core.startDrag(editId)

    const name = basename(res.filePath)
    expect(name).toMatch(/edited/i)
    expect(name.endsWith('.wav')).toBe(true)
    expect(res.filePath.startsWith(join(dataDir, 'drag'))).toBe(true)

    const editLocalPath = editPath(dataDir, RAIN)
    expect(res.filePath).not.toBe(editLocalPath)
    expect(statSync(res.filePath).ino).toBe(statSync(editLocalPath).ino)
    expect(readFileSync(res.filePath, 'utf8')).toBe('EDIT-BYTES')
  })

  it('refuses a drag for an Edit whose render has not finished — never a fallback', async () => {
    const { runner, release } = controllableRenderRunner()
    const { core, host, dataDir } = await dragCore({
      audioRenderRunner: runner,
    })
    await stageReady(core, RAIN.id)

    const pending = core.createEdit(RAIN.id, WHOLE_FILE_SPEC)
    expect(() => core.startDrag(-1)).toThrow(OriginalNotStagedError)
    expect(host.drags).toHaveLength(0)
    expect(existsSync(join(dataDir, 'drag'))).toBe(false)

    release()
    const result = await pending
    expect(result!.editId).toBe(-1)

    const res = core.startDrag(-1)
    expect(existsSync(res.filePath)).toBe(true)
  })

  it('a mixed drag of a Sound and an Edit hands over both', async () => {
    const { core, host } = await dragCore({
      multiFileDragSupported: true,
      audioRenderRunner: fakeRenderRunner({ bytes: 'EDIT-BYTES' }),
    })
    await stageReady(core, RAIN.id)
    const { editId } = (await core.createEdit(RAIN.id, WHOLE_FILE_SPEC))!

    const res = core.startDrag([RAIN.id, editId])

    expect(res.soundIds).toEqual([RAIN.id, editId])
    expect(res.extraFilePaths).toHaveLength(1)
    expect(readFileSync(host.last!.filePath, 'utf8')).toBe(
      originalBytes(RAIN.id),
    )
    expect(readFileSync(host.last!.extraFilePaths[0]!, 'utf8')).toBe(
      'EDIT-BYTES',
    )
  })
})
