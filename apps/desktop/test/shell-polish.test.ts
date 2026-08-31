// Ticket 18 — shell polish, at the core seam.
//
// The renderer-side pieces (the notification host, the shortcut dialog, the
// dark theme, the "opens without a blank window" behaviour) need the Electron
// GUI and are listed under "Needs manual verification" in PROGRESS.md. What is
// testable here is the behaviour the core owns: the persisted shell state, the
// app log, the error classifier every surface shares, and the drag-dir sweep.

import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  classifyError,
  createFileLogSink,
  mergeUiState,
  normaliseUiState,
  AuthError,
  DiskError,
  NetworkError,
  ThrottledError,
  GatewayError,
  type LogSink,
} from '../src/core'
import { makeTestCore, makeFakeGateway } from './helpers/makeTestCore'

/** An in-memory `LogSink` so a test can read back exactly what was written. */
function memorySink(): LogSink & { lines: string[] } {
  const lines: string[] = []
  return {
    lines,
    path: '/tmp/fake/app.log',
    append: (line) => lines.push(line),
    read: (max) => (max > 0 ? lines.slice(-max) : lines.slice()),
  }
}

describe('normaliseUiState — a stored blob is advisory, never load-bearing', () => {
  it('drops unknown keys and coerces the known ones', () => {
    expect(
      normaliseUiState({
        view: 'library',
        query: 'rain',
        openCollectionId: 7,
        selectedSoundId: null,
        nonsense: true,
      }),
    ).toEqual({
      view: 'library',
      query: 'rain',
      openCollectionId: 7,
      selectedSoundId: null,
    })
  })

  it('rejects a bad view, a non-string query and a tiny / offscreen window', () => {
    expect(normaliseUiState({ view: 'nope' })).toEqual({})
    expect(normaliseUiState({ query: 123 })).toEqual({})
    expect(normaliseUiState({ window: { width: 100, height: 100 } })).toEqual({})
    expect(
      normaliseUiState({ window: { width: 1024, height: 768, x: 20, y: 40 } }),
    ).toEqual({ window: { width: 1024, height: 768, x: 20, y: 40 } })
  })

  it('is total — anything unparseable becomes the empty state', () => {
    expect(normaliseUiState(null)).toEqual({})
    expect(normaliseUiState('garbage')).toEqual({})
    expect(normaliseUiState(42)).toEqual({})
  })
})

describe('mergeUiState — a patch touches only the keys it names', () => {
  it('keeps unspecified keys, clears with null, replaces window wholesale', () => {
    const base = normaliseUiState({
      view: 'search',
      query: 'thunder',
      window: { width: 900, height: 700 },
      openCollectionId: 3,
    })
    const next = mergeUiState(base, {
      view: 'collections',
      openCollectionId: null,
    })
    expect(next).toEqual({
      view: 'collections',
      query: 'thunder',
      window: { width: 900, height: 700 },
      openCollectionId: null,
    })
  })

  it('an undefined value in the patch is a no-op', () => {
    const base = normaliseUiState({ view: 'library' })
    expect(mergeUiState(base, { view: undefined, query: 'x' })).toEqual({
      view: 'library',
      query: 'x',
    })
  })
})

describe('core.getUiState / setUiState', () => {
  it('defaults to the empty state and persists a patch across a restart', async () => {
    const { core, dbPath, dataDir } = await makeTestCore()
    expect(core.getUiState()).toEqual({})

    core.setUiState({ view: 'library', query: 'rain' })
    core.setUiState({ window: { width: 1200, height: 800, x: 10, y: 10 } })
    // A window-only patch must not wipe the view/query written before it.
    expect(core.getUiState()).toEqual({
      view: 'library',
      query: 'rain',
      window: { width: 1200, height: 800, x: 10, y: 10 },
    })
    core.close()

    const again = await makeTestCore({ dbPath, dataDir })
    expect(again.core.getUiState()).toEqual({
      view: 'library',
      query: 'rain',
      window: { width: 1200, height: 800, x: 10, y: 10 },
    })
    again.core.close()
  })
})

describe('the app log', () => {
  it('with no sink wired, getLogPath is null and readLog is empty', async () => {
    const { core } = await makeTestCore()
    expect(core.getLogPath()).toBeNull()
    core.log('info', 'nothing to see')
    expect(core.readLog()).toEqual([])
    core.close()
  })

  it('records lines through log() and returns the tail oldest-first', async () => {
    const sink = memorySink()
    const { core } = await makeTestCore({ logSink: sink })
    core.log('info', 'app started')
    core.log('warn', 'something odd', { soundId: 5 })
    core.log('error', 'boom')

    const all = core.readLog()
    expect(all).toHaveLength(3)
    expect(all[0]).toMatch(/INFO\s+app started/)
    expect(all[1]).toMatch(/WARN\s+something odd\s+\{"soundId":5\}/)
    expect(core.readLog({ maxLines: 1 })).toEqual([all[2]])
    expect(core.getLogPath()).toBe('/tmp/fake/app.log')
    core.close()
  })

  it('logs a failed search — the failure the user sees is also on disk', async () => {
    const sink = memorySink()
    const gateway = makeFakeGateway()
    // Make every search reject like a dead connection.
    gateway.search = () => Promise.reject(new NetworkError('offline'))
    const { core } = await makeTestCore({ gateway, logSink: sink })

    await expect(core.search('rain')).rejects.toThrow()
    expect(sink.lines.some((l) => /search failed/.test(l))).toBe(true)
    expect(sink.lines.some((l) => /NetworkError/.test(l))).toBe(true)
    core.close()
  })
})

describe('createFileLogSink — a real file under <userData>/logs', () => {
  it('creates the dir on first write and reads whole lines back', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'freesound-log-'))
    const sink = createFileLogSink(join(dir, 'logs'))
    sink.append('2026-08-31T00:00:00.000Z  INFO   one')
    sink.append('2026-08-31T00:00:01.000Z  WARN   two')
    expect(existsSync(join(dir, 'logs', 'app.log'))).toBe(true)
    expect(sink.read(10)).toEqual([
      '2026-08-31T00:00:00.000Z  INFO   one',
      '2026-08-31T00:00:01.000Z  WARN   two',
    ])
    expect(sink.read(1)).toEqual(['2026-08-31T00:00:01.000Z  WARN   two'])
  })
})

describe('classifyError — the one classifier every surface shares', () => {
  it('separates connectivity, throttling, auth, download and disk', () => {
    expect(classifyError(new NetworkError('offline')).kind).toBe('network')

    const t = classifyError(new ThrottledError(30))
    expect(t.kind).toBe('throttled')
    expect(t.retryAfter).toBe(30)
    expect(t.actionable).toBe(true)

    expect(classifyError(new AuthError()).kind).toBe('auth')

    const noSpace = classifyError(new DiskError('write ENOSPC', 'ENOSPC'))
    expect(noSpace.kind).toBe('disk')
    expect(noSpace.title).toMatch(/full/i)
    expect(noSpace.actionable).toBe(true)
  })

  it('says plainly when there is nothing the user can do', () => {
    const server = classifyError(new GatewayError('Freesound 503', 503))
    expect(server.kind).toBe('download')
    expect(server.actionable).toBe(false)

    const weird = classifyError(new Error('??'))
    expect(weird.kind).toBe('unknown')
    expect(weird.actionable).toBe(false)
  })

  it('still classifies an error that lost its prototype crossing IPC', () => {
    // structured-clone keeps `name` + `message` but not the class.
    const overIpc = { name: 'ThrottledError', message: 'Rate-limited. Retry in 45s.' }
    const c = classifyError(overIpc)
    expect(c.kind).toBe('throttled')
    expect(c.retryAfter).toBe(45)
  })
})

describe('drag-dir sweep on startup (ticket 09 deferred this to 18)', () => {
  it('clears leftover hardlinks from a previous run', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'freesound-drag-'))
    await mkdir(join(dataDir, 'drag'), { recursive: true })
    await writeFile(join(dataDir, 'drag', '123.wav'), 'stale')
    await writeFile(join(dataDir, 'drag', '456.wav'), 'stale')

    const { core } = await makeTestCore({ dataDir })
    expect(await readdir(join(dataDir, 'drag'))).toEqual([])
    core.close()
  })
})
