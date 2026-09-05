/**
 * Removes narrative comments from the TypeScript/JavaScript sources.
 *
 * Kept: JSDoc, and directive comments the toolchain needs (@ts-*, eslint-*,
 * prettier-ignore, triple-slash reference, @vite-ignore, PURE). Removed: every
 * other line comment and block comment.
 *
 * Usage: node scripts/strip-comments.mjs [--check]
 * Requires the TypeScript compiler (resolved from apps/desktop).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'apps/desktop/package.json'))
/** @type {typeof import('typescript')} */
const ts = require('typescript')

const PATTERNS = [
  'apps/desktop/src/**/*.ts',
  'apps/desktop/src/**/*.tsx',
  'apps/desktop/test/**/*.ts',
  'apps/desktop/test/**/*.tsx',
  'apps/desktop/*.ts',
  'apps/desktop/*.js',
  'apps/desktop/scripts/*.mjs',
  'worker/src/**/*.ts',
  'worker/test/**/*.ts',
  'worker/*.ts',
  'scripts/*.mjs',
]

const KEEP = [
  /^\/\*\*/, // JSDoc
  /^\/\/\/\s*</, // triple-slash directive
  /@ts-(expect-error|ignore|nocheck)/,
  /eslint-(disable|enable)/,
  /^\/\*\s*globals?\s/,
  /prettier-ignore/,
  /@vite-ignore/,
  /webpackChunkName/,
  /@__PURE__|#__PURE__/,
]

const shouldKeep = (t) => KEEP.some((re) => re.test(t.trim()))

/** @param {string} text @param {boolean} tsx */
function stripFile(text, tsx) {
  const sf = ts.createSourceFile(
    tsx ? 'f.tsx' : 'f.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
    tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  /** @type {Map<number, {end:number}>} */
  const ranges = new Map()
  const collect = (arr) => {
    for (const r of arr ?? []) {
      const body = text.slice(r.pos, r.end)
      if (!shouldKeep(body)) ranges.set(r.pos, { end: r.end })
    }
  }
  const visit = (node) => {
    collect(ts.getLeadingCommentRanges(text, node.getFullStart()))
    collect(ts.getTrailingCommentRanges(text, node.getEnd()))
    node.forEachChild(visit)
  }
  visit(sf)
  collect(ts.getLeadingCommentRanges(text, sf.getEnd()))

  if (ranges.size === 0) return text

  const sorted = [...ranges.entries()].sort((a, b) => b[0] - a[0])
  let out = text
  for (const [pos, { end }] of sorted) {
    let s = pos
    let e = end
    const before = out.slice(0, s)
    const lineStart = before.lastIndexOf('\n') + 1
    const prefixBlank = out.slice(lineStart, s).trim() === ''
    if (prefixBlank) {
      s = lineStart
      if (out[e] === '\r') e++
      if (out[e] === '\n') e++
    } else {
      while (s > 0 && (out[s - 1] === ' ' || out[s - 1] === '\t')) s--
    }
    out = out.slice(0, s) + out.slice(e)
  }

  out = out
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '\n')
  return out
}

const files = [
  ...new Set(
    PATTERNS.flatMap((p) => globSync(p, { cwd: root }).map((f) => join(root, f))),
  ),
].sort()

const check = process.argv.includes('--check')
let changed = 0
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const tsx = file.endsWith('.tsx')
  const next = stripFile(src, tsx)
  if (next !== src) {
    changed++
    if (check) console.log('would change', file.slice(root.length + 1))
    else writeFileSync(file, next)
  }
}
console.log(
  `${check ? 'would change' : 'changed'} ${changed} / ${files.length} files`,
)
