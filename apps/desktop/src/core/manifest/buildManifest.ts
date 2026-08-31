// Attribution Manifest generation (ticket 17) — pure, no I/O, no Electron.
//
// A Manifest is generated FOR a Collection and is a SNAPSHOT: `core.generateManifest`
// reads the Collection's membership once, passes it here, and returns the result.
// Nothing is stored; the value the caller holds is frozen in time and does not
// change when the Collection is edited afterwards (CONTEXT.md § Attribution Manifest).
//
// The `text` field is the whole point — a plain-text credits document a user
// pastes verbatim into a video description, a README or a client deliverable. It
// must read correctly with no renderer: fixed-width friendly, ASCII rules, one
// blank line between blocks.
//
// Grouping mirrors the spec:
//   1. NON-COMMERCIAL sounds first, flagged prominently and listed on their own,
//      because building paid work on them is the expensive mistake.
//   2. ATTRIBUTION REQUIRED — everything that is not CC0. NC sounds appear here
//      too (they still need crediting) with an inline [NON-COMMERCIAL] marker.
//   3. NO ATTRIBUTION REQUIRED — the CC0 material, kept separate so it does not
//      pad the credits.

import type { Sound } from '../types'
import { requiresAttribution, restrictsCommercialUse } from './obligations'

/** The per-Sound fields a Manifest is built from — `LibrarySound` satisfies this. */
export type ManifestSourceSound = Pick<
  Sound,
  'id' | 'name' | 'username' | 'url' | 'license'
>

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

const RULE_WIDTH = 60

/** `── LABEL ─────────` padded to `RULE_WIDTH`. */
function heading(label: string): string {
  const prefix = `── ${label} `
  const pad = Math.max(3, RULE_WIDTH - prefix.length)
  return prefix + '─'.repeat(pad)
}

function entryBlock(e: ManifestEntry, opts: { markNc: boolean } = { markNc: false }): string {
  const ncMark = opts.markNc && e.restrictsCommercialUse ? '  [NON-COMMERCIAL]' : ''
  return [
    `  • "${e.title}" by ${e.author}${ncMark}`,
    `    ${e.licenseName} — ${e.licenseUrl}`,
    `    ${e.freesoundUrl}`,
  ].join('\n')
}

/** `2026-08-30` — locale-independent so the snapshot is byte-stable. */
function isoDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10)
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
  }
}

export function buildManifest(input: ManifestInput): Manifest {
  const { collectionId, collectionName, generatedAt } = input
  const entries = input.sounds.map(toEntry)
  const title = `Attribution Manifest — "${input.collectionName}"`
  const dateLine = `Generated ${isoDate(input.generatedAt)}`

  const attributed = entries.filter((e) => e.requiresAttribution)
  const cc0 = entries.filter((e) => !e.requiresAttribution)
  const nc = entries.filter((e) => e.restrictsCommercialUse)

  const summary: ManifestSummary = {
    total: entries.length,
    attributionRequired: attributed.length,
    noAttribution: cc0.length,
    nonCommercial: nc.length,
  }

  // Empty Collection: a clear message, never a blank document.
  if (entries.length === 0) {
    const text = [
      title,
      dateLine,
      '',
      'This collection has no sounds, so there is nothing to attribute yet.',
      'Add sounds to the collection and generate the manifest again.',
    ].join('\n')
    return { collectionId, collectionName, generatedAt, entries, summary, text }
  }

  const sn = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

  const intro: string[] = [`This project uses ${sn(entries.length, 'sound', 'sounds')} from Freesound.`]
  if (attributed.length > 0 && cc0.length > 0) {
    intro.push(
      `${sn(attributed.length, 'sound requires', 'sounds require')} attribution; ` +
        `${sn(cc0.length, 'is', 'are')} CC0 and ${cc0.length === 1 ? 'needs' : 'need'} none.`,
    )
  } else if (cc0.length === 0) {
    intro.push(`All of them require attribution.`)
  } else {
    intro.push(`All of them are CC0 — no attribution is required.`)
  }
  if (nc.length > 0) {
    intro.push(
      `${sn(nc.length, 'sound is', 'sounds are')} licensed for NON-COMMERCIAL use ` +
        `only — see the warning below.`,
    )
  }

  const blocks: string[] = [title, dateLine, '', intro.join('\n')]

  if (nc.length > 0) {
    blocks.push(
      heading('NON-COMMERCIAL — NOT CLEARED FOR PAID WORK'),
      '  These sounds forbid commercial use. Do NOT ship them in paid work.\n' +
        "  Remove them, or get the author's written permission, before delivery.",
      nc.map((e) => entryBlock(e)).join('\n\n'),
    )
  }

  if (attributed.length > 0) {
    blocks.push(
      heading('ATTRIBUTION REQUIRED'),
      '  Credit each of these wherever you publish the work.',
      attributed.map((e) => entryBlock(e, { markNc: true })).join('\n\n'),
    )
  }

  if (cc0.length > 0) {
    blocks.push(
      heading('NO ATTRIBUTION REQUIRED (CC0)'),
      '  Public-domain dedication — crediting is welcome but not required.',
      cc0.map((e) => entryBlock(e)).join('\n\n'),
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
