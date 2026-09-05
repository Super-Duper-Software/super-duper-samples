import { Buffer } from 'node:buffer'
import type { Sound } from '../types'

/** Cap on the sanitised name stem, before the extension. */
const MAX_STEM_LEN = 120

const ILLEGAL_NAME_CHARS = /[/\\:*?"<>|]/g
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g

/**
 * A filesystem-safe, human-readable name stem. Drops a trailing extension that
 * duplicates the real one, strips characters illegal on macOS or Windows,
 * collapses whitespace, and never ends in a dot or space. Falls back to
 * `sound-<id>` if nothing is left.
 */
export function sanitiseStem(
  sound: Pick<Sound, 'id' | 'name'>,
  ext: string,
): string {
  let stem = sound.name ?? ''
  if (stem.toLowerCase().endsWith(`.${ext}`)) {
    stem = stem.slice(0, -(ext.length + 1))
  }
  stem = stem
    .normalize('NFC')
    .replace(CONTROL_CHARS, ' ')
    .replace(ILLEGAL_NAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .slice(0, MAX_STEM_LEN)
    .replace(/[.\s]+$/, '')
  return stem || `sound-${sound.id}`
}

/** `data:image/png;base64,…` → bytes + extension, or `null` if not a usable image. */
export function decodeDataUrl(
  url: string | undefined,
): { bytes: Buffer; ext: 'png' | 'jpg' } | null {
  if (!url || !url.startsWith('data:image/')) return null
  const comma = url.indexOf(',')
  if (comma < 0) return null
  const meta = url.slice('data:'.length, comma)
  if (!meta.includes('base64')) return null
  const bytes = Buffer.from(url.slice(comma + 1), 'base64')
  if (bytes.byteLength === 0) return null
  return {
    bytes,
    ext: meta.includes('jpeg') || meta.includes('jpg') ? 'jpg' : 'png',
  }
}
