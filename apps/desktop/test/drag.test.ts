// Ticket 09 — real drag-out, at the core seam. No Electron: a recording
// `DragHost` stands in for `webContents.startDrag`, so every test asserts
// exactly what path the app would hand the operating system. Real temp SQLite,
// real temp filesystem, fake gateway.
//
// Covers the ticket's test list:
//   - the path handed to DragHost has a human-readable basename derived from the
//     Sound (not the `<id>.<ext>` store name)
//   - it is a hardlink to the content store, not a copy and not the store path
//   - it is the Original, never a preview URL
//   - it still resolves after the staged Original is evicted
//   - a drag requested before the Original is present is refused (typed error),
//     never served a Preview, never a silent no-op
//   - two Sounds that sanitise to the same name arrive as distinct files
//   - multi-Sound drag is gated to platforms ticket 01 verified

import {
  existsSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createRecordingDragHost,
  OriginalNotStagedError,
  type RecordingDragHost,
} from '../src/core'
import { openDb, type DB } from '../src/core/db/index'
import { upsertSound } from '../src/core/db/sounds'
import { writeOriginal } from '../src/core/staging/contentStore'
import type { Sound } from '../src/core/types'
import { makeFakeGateway, makeTestCore } from './helpers/makeTestCore'

const RAIN_ID = 321967 // "Rain_Heavy_Loop.wav", type wav, in search-rain.json

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

/**
 * A signed-in, consenting core wired to a recording `DragHost`. Returns the core
 * plus the host and a `base` Sound (321967) to clone for crafted fixtures.
 */
async function dragCore(
  opts: { multiFileDragSupported?: boolean } = {},
) {
  const host = createRecordingDragHost({
    multiFileDragSupported: opts.multiFileDragSupported ?? false,
  })
  const tc = await makeTestCore({ gateway: makeFakeGateway(), dragHost: host })
  cleanups.push(() => tc.core.close())
  await tc.core.signIn()
  tc.core.grantStagingConsent()
  const base = (await tc.core.search('rain')).sounds.find((s) => s.id === RAIN_ID)!
  return { ...tc, host: host as RecordingDragHost, base }
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

/** Stage a crafted Sound: write a `sounds` row + its Original + sidecar. */
async function stageCrafted(
  db: DB,
  dataDir: string,
  base: Sound,
  id: number,
  name: string,
): Promise<Sound> {
  const sound: Sound = { ...base, id, name, type: 'wav' }
  upsertSound(db, sound)
  await writeOriginal(dataDir, sound, new TextEncoder().encode(`ORIG-${id}`), Date.now())
  return sound
}

async function stageRain(core: Awaited<ReturnType<typeof dragCore>>['core']): Promise<void> {
  core.stageOnAudition(RAIN_ID)
  await waitUntil(() => core.getStagingStatus([RAIN_ID])[RAIN_ID] === 'ready')
}

describe('core.startDrag — the OS hand-off', () => {
  it('drags a hardlinked, human-named Original — not the store path, not a Preview', async () => {
    const { core, host, dataDir } = await dragCore()
    await stageRain(core)

    const res = core.startDrag(RAIN_ID)

    // what the app handed the OS
    expect(host.drags).toHaveLength(1)
    expect(host.last!.filePath).toBe(res.filePath)
    expect(res.soundIds).toEqual([RAIN_ID])
    expect(res.extraFilePaths).toEqual([])

    // human-readable basename derived from the Sound, NOT `321967.wav`
    const name = basename(res.filePath)
    expect(name).not.toBe(`${RAIN_ID}.wav`)
    expect(name).toMatch(/rain/i)
    expect(name.endsWith('.wav')).toBe(true)

    // it lives in the private drag dir, and is not a URL / preview
    expect(res.filePath.startsWith(join(dataDir, 'drag'))).toBe(true)
    expect(res.filePath).not.toMatch(/^https?:/)
    expect(res.filePath.toLowerCase()).not.toContain('preview')

    // it is a HARDLINK to the content-store Original (same inode, >1 link), not a copy
    const storePath = join(dataDir, 'content', `${RAIN_ID}.wav`)
    expect(statSync(res.filePath).ino).toBe(statSync(storePath).ino)
    expect(statSync(res.filePath).nlink).toBeGreaterThanOrEqual(2)

    // and it carries the Original's bytes (from the fake gateway), not a preview
    expect(readFileSync(res.filePath, 'utf8')).toBe(`FAKE-ORIGINAL:${RAIN_ID}`)

    // the drag icon is a real, non-empty file
    expect(host.last!.iconPath).toBeTruthy()
    expect(existsSync(host.last!.iconPath)).toBe(true)
  })

  it('the dropped file still resolves after the app quits and the staged Original is evicted', async () => {
    const { core, dataDir, dbPath } = await dragCore()
    await stageRain(core)
    const res = core.startDrag(RAIN_ID)

    // simulate ticket-10 eviction of the staged Original
    const storePath = join(dataDir, 'content', `${RAIN_ID}.wav`)
    rmSync(storePath)
    rmSync(join(dataDir, 'content', `${RAIN_ID}.json`))
    openTemp(dbPath).prepare('DELETE FROM staged_entries WHERE sound_id = ?').run(RAIN_ID)

    expect(existsSync(storePath)).toBe(false)
    // the hardlink is a second directory entry for the same inode — bytes live on
    expect(readFileSync(res.filePath, 'utf8')).toBe(`FAKE-ORIGINAL:${RAIN_ID}`)
  })

  it('re-dragging the same Sound reuses the same hardlink (idempotent)', async () => {
    const { core } = await dragCore()
    await stageRain(core)

    const a = core.startDrag(RAIN_ID)
    const b = core.startDrag(RAIN_ID)
    expect(b.filePath).toBe(a.filePath)
  })
})

describe('core.startDrag — refusing an unstaged Sound', () => {
  it('refuses with a visible explanation — never a Preview, never a silent no-op', async () => {
    const { core, host, dataDir } = await dragCore()
    await core.search('rain') // the `sounds` row exists, but nothing is staged

    expect(() => core.startDrag(RAIN_ID)).toThrow(OriginalNotStagedError)

    let msg = ''
    try {
      core.startDrag(RAIN_ID)
    } catch (err) {
      msg = (err as Error).message
    }
    expect(msg).toMatch(/a Preview is never dragged/i)
    expect(msg).toContain('Rain_Heavy_Loop') // names the Sound

    // nothing was handed to the OS and no drag artefacts were created
    expect(host.drags).toHaveLength(0)
    expect(existsSync(join(dataDir, 'drag'))).toBe(false)
  })

  it('refuses the whole multi-Sound drag if any one Sound is not staged', async () => {
    const { core, host, dataDir, dbPath, base } = await dragCore({
      multiFileDragSupported: true,
    })
    const db = openTemp(dbPath)
    await stageCrafted(db, dataDir, base, 8001, 'Thunder clap')
    // 8002 has metadata but no Original on disk
    upsertSound(db, { ...base, id: 8002, name: 'Rain hiss', type: 'wav' })

    expect(() => core.startDrag([8001, 8002])).toThrow(OriginalNotStagedError)
    expect(host.drags).toHaveLength(0)
  })
})

describe('core.startDrag — filename collisions', () => {
  it('two Sounds that sanitise to the same name arrive as distinct files', async () => {
    const { core, dataDir, dbPath, base } = await dragCore()
    const db = openTemp(dbPath)
    await stageCrafted(db, dataDir, base, 9001, 'Ocean: waves') // ':' -> ' '
    await stageCrafted(db, dataDir, base, 9002, 'Ocean/waves') // '/' -> ' '

    const r1 = core.startDrag(9001)
    const r2 = core.startDrag(9002)

    expect(basename(r1.filePath)).toBe('Ocean waves.wav')
    expect(basename(r2.filePath)).toBe('Ocean waves (2).wav')
    expect(r1.filePath).not.toBe(r2.filePath)
    expect(existsSync(r1.filePath) && existsSync(r2.filePath)).toBe(true)

    // each points at its OWN Original
    expect(readFileSync(r1.filePath, 'utf8')).toBe('ORIG-9001')
    expect(readFileSync(r2.filePath, 'utf8')).toBe('ORIG-9002')
  })
})

describe('core.startDrag — multi-Sound gating (ticket 01)', () => {
  it('links every Sound where ticket 01 verified multi-file delivery', async () => {
    const { core, host, dataDir, dbPath, base } = await dragCore({
      multiFileDragSupported: true,
    })
    const db = openTemp(dbPath)
    await stageCrafted(db, dataDir, base, 8001, 'Thunder clap')
    await stageCrafted(db, dataDir, base, 8002, 'Rain hiss')

    const res = core.startDrag([8001, 8002])

    expect(core.getDragCapabilities().multiSound).toBe(true)
    expect(res.soundIds).toEqual([8001, 8002])
    expect(res.extraFilePaths).toHaveLength(1)
    expect(basename(host.last!.filePath)).toBe('Thunder clap.wav')
    expect(basename(host.last!.extraFilePaths[0]!)).toBe('Rain hiss.wav')
    // both are hardlinks to their own Originals
    expect(readFileSync(res.filePath, 'utf8')).toBe('ORIG-8001')
    expect(readFileSync(res.extraFilePaths[0]!, 'utf8')).toBe('ORIG-8002')
  })

  it('drags only the first Sound where ticket 01 did not verify it', async () => {
    const { core, host, dataDir, dbPath, base } = await dragCore({
      multiFileDragSupported: false,
    })
    const db = openTemp(dbPath)
    await stageCrafted(db, dataDir, base, 8001, 'Thunder clap')
    await stageCrafted(db, dataDir, base, 8002, 'Rain hiss')

    const res = core.startDrag([8001, 8002])

    expect(core.getDragCapabilities().multiSound).toBe(false)
    expect(res.soundIds).toEqual([8001])
    expect(res.extraFilePaths).toEqual([])
    expect(host.last!.extraFilePaths).toEqual([])
  })
})

describe('core.startDrag — not configured', () => {
  it('throws a clear error when the core has no DragHost', async () => {
    const tc = await makeTestCore({ gateway: makeFakeGateway() })
    cleanups.push(() => tc.core.close())
    await tc.core.signIn()
    tc.core.grantStagingConsent()
    await tc.core.search('rain')
    tc.core.stageOnAudition(RAIN_ID)
    await waitUntil(
      () => tc.core.getStagingStatus([RAIN_ID])[RAIN_ID] === 'ready',
    )

    expect(tc.core.getDragCapabilities().multiSound).toBe(false)
    expect(() => tc.core.startDrag(RAIN_ID)).toThrow(/not configured/i)
  })
})
