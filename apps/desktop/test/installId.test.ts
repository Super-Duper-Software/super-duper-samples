import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getOrCreateInstallId } from '../src/main/installId'
import { makeTempDir } from './helpers'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('getOrCreateInstallId', () => {
  it('creates a UUID on first run and persists it to <dataDir>/install-id', async () => {
    const dir = await makeTempDir('sds-install-')

    const id = getOrCreateInstallId(dir)

    expect(id).toMatch(UUID_RE)
    expect(readFileSync(join(dir, 'install-id'), 'utf8').trim()).toBe(id)
  })

  it('returns the same id on every later run', async () => {
    const dir = await makeTempDir('sds-install-')

    const first = getOrCreateInstallId(dir)
    const second = getOrCreateInstallId(dir)

    expect(second).toBe(first)
  })

  it('replaces a corrupt id file with a fresh UUID', async () => {
    const dir = await makeTempDir('sds-install-')
    writeFileSync(join(dir, 'install-id'), 'not-a-uuid', 'utf8')

    const id = getOrCreateInstallId(dir)

    expect(id).toMatch(UUID_RE)
  })

  it('returns undefined when the dir cannot be written', () => {
    expect(getOrCreateInstallId('/no/such/path/at/all')).toBeUndefined()
  })
})
