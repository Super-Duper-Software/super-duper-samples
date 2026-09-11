import type { LibrarySound } from '../types'
import { requiresAttribution, restrictsCommercialUse } from './obligations'

/**
 * The per-Sound fields a Manifest is built from — `LibrarySound` satisfies this.
 * `derivedFrom` is non-null exactly when the Sound is an Edit; its
 * author / License / URL are already the parent's own (`createEdit` copies
 * them at render time), so this is only consulted for the "edited" marker.
 * Optional (defaults to "not an Edit") so a plain `Sound` still satisfies this.
 */
export type ManifestSourceSound = Pick<
  LibrarySound,
  'id' | 'name' | 'username' | 'url' | 'license'
> & {
  derivedFrom?: LibrarySound['derivedFrom']
}

export interface ManifestEntry {
  soundId: number
  /** The Sound's published Freesound title — what CC-BY attribution names. */
  title: string
  /** The uploading author's Freesound username. */
  author: string
  /** Short license label, e.g. `CC-BY`, `CC0`, `CC-BY-NC`. */
  licenseName: string
  /** Canonical Creative Commons deed URL. */
  licenseUrl: string
  /** The Sound's page on freesound.org. */
  freesoundUrl: string
  /** False only for CC0. */
  requiresAttribution: boolean
  /** True for the CC NonCommercial family (and anything unrecognised). */
  restrictsCommercialUse: boolean
  /** True when this entry is an Edit — credited to its parent. */
  isEdit: boolean
}

export interface ManifestSummary {
  total: number
  attributionRequired: number
  noAttribution: number
  nonCommercial: number
}

export interface Manifest {
  collectionId: number
  collectionName: string
  /** Epoch ms this snapshot was generated. */
  generatedAt: number
  /** Every member of the Collection at generation time, in the order given. */
  entries: readonly ManifestEntry[]
  summary: ManifestSummary
  /** The rendered plain-text credits document. Copy or save this verbatim. */
  text: string
}

export interface ManifestInput {
  collectionId: number
  collectionName: string
  /** Epoch ms — the snapshot timestamp. The caller passes `Date.now()`. */
  generatedAt: number
  /** The Collection's members, already ordered as they should appear. */
  sounds: readonly ManifestSourceSound[]
}

const EMPTY_MESSAGE = 'This collection is empty — nothing to attribute yet.'

/**
 * The parenthetical note appended to a credit line: the NC warning and/or the
 * "edited" marker (an Edit is credited to its parent but must read
 * as unambiguously modified), comma-joined when both apply.
 */
function marker(e: ManifestEntry): string {
  const parts: string[] = []
  if (e.restrictsCommercialUse) parts.push('non-commercial use only')
  if (e.isEdit) parts.push('edited')
  return parts.length > 0 ? ` (${parts.join(', ')})` : ''
}

/** `"Title" by author — CC-BY` (+ inline NC/edited note), then the Freesound URL. */
function creditLines(e: ManifestEntry): string {
  return `"${e.title}" by ${e.author} — ${e.licenseName}${marker(e)}\n${e.freesoundUrl}`
}

/** `"Title" by author — https://freesound.org/s/…` — one line, for CC0. */
function creditLineShort(e: ManifestEntry): string {
  const edited = e.isEdit ? ' (edited)' : ''
  return `"${e.title}" by ${e.author}${edited} — ${e.freesoundUrl}`
}

/** `"Title" by author — CC-BY-NC — https://freesound.org/s/…` — the NC recap. */
function creditLineWithLicense(e: ManifestEntry): string {
  const edited = e.isEdit ? ' (edited)' : ''
  return `"${e.title}" by ${e.author}${edited} — ${e.licenseName} — ${e.freesoundUrl}`
}

function toEntry(s: ManifestSourceSound): ManifestEntry {
  return {
    soundId: s.id,
    title: s.name,
    author: s.username,
    licenseName: s.license.name,
    licenseUrl: s.license.url,
    freesoundUrl: s.url,
    requiresAttribution: requiresAttribution(s.license.name),
    restrictsCommercialUse: restrictsCommercialUse(s.license.name),
    isEdit: (s.derivedFrom ?? null) !== null,
  }
}

export function buildManifest(input: ManifestInput): Manifest {
  const { collectionId, collectionName, generatedAt } = input
  const entries = input.sounds.map(toEntry)

  const attributed = entries.filter((e) => e.requiresAttribution)
  const cc0 = entries.filter((e) => !e.requiresAttribution)
  const nc = entries.filter((e) => e.restrictsCommercialUse)

  const summary: ManifestSummary = {
    total: entries.length,
    attributionRequired: attributed.length,
    noAttribution: cc0.length,
    nonCommercial: nc.length,
  }

  const blocks: string[] = []

  if (entries.length === 0) {
    blocks.push(EMPTY_MESSAGE)
  }

  if (attributed.length > 0) {
    blocks.push(attributed.map(creditLines).join('\n\n'))
  }

  if (cc0.length > 0) {
    blocks.push(
      'CC0 (public domain, no attribution required):\n' +
        cc0.map(creditLineShort).join('\n'),
    )
  }

  if (nc.length > 0) {
    blocks.push(
      'Non-commercial licenses — not cleared for commercial use:\n' +
        nc.map(creditLineWithLicense).join('\n'),
    )
  }

  return {
    collectionId,
    collectionName,
    generatedAt,
    entries,
    summary,
    text: blocks.join('\n\n'),
  }
}
