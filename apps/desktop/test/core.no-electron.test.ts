import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const coreDir = fileURLToPath(new URL('../src/core', import.meta.url))

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full)
  }
  return out
}

const IMPORTS_ELECTRON =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]electron(?:\/[^'"]*)?['"]/

describe('core is a plain Node module', () => {
  it('no file under src/core imports electron', () => {
    const files = walk(coreDir)
    expect(files.length).toBeGreaterThan(0)

    const offenders = files.filter((f) =>
      IMPORTS_ELECTRON.test(readFileSync(f, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
