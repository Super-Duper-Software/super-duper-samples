import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FILE = 'install-id'
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A stable random id for this installation, created on first run and kept in a
 * plain `install-id` file under the Electron `userData` dir. Its only use is the
 * token Worker's anonymous monthly-active-user count (`worker/README.md`): the
 * app sends it as `install_id` on `/exchange` and `/refresh`, the Worker stores
 * only a salted hash of it.
 *
 * Returns `undefined` when the id can neither be read nor written, so a fresh
 * per-launch id is never reported (which would inflate the count).
 */
export function getOrCreateInstallId(dataDir: string): string | undefined {
  const path = join(dataDir, FILE)
  try {
    const existing = readFileSync(path, 'utf8').trim()
    if (UUID_RE.test(existing)) return existing
  } catch {
    // no readable id yet — create one below
  }
  const fresh = randomUUID()
  try {
    writeFileSync(path, `${fresh}\n`, 'utf8')
    return fresh
  } catch {
    return undefined
  }
}
