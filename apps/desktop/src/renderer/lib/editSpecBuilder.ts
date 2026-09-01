// Ticket 08 — pure helpers behind the Edit view's export dialog: turning the
// dialog's form state (+ the marked region, if any) into an `EditSpec` for
// `createEdit`, and picking the `edited` / `edited (N)` name default the
// dialog pre-fills. No DOM, no I/O — mirrors `regionGeometry.ts`'s shape.

import type { EditSpec } from '../../preload'
import type { Region } from './regionGeometry'
import { regionToSeconds } from './regionGeometry'

/** The export dialog's own form state — everything the user can pick. */
export interface ExportDialogState {
  /** Export only the marked region, not the whole file. Ignored (whole file) when `region` is `null`. */
  trimToRegion: boolean
  format: EditSpec['format']
  /** `undefined` keeps the source sample rate ("Same as source"). */
  sampleRate?: number
  /** `undefined` keeps the source channel count ("Same as source"). */
  channels?: 1 | 2
  normalize: boolean
}

/**
 * Build the `EditSpec` `createEdit` expects from the dialog's form state, the
 * marked region (or `null`) and the source's total duration. `trimToRegion`
 * is only honoured when a region is actually marked — an export with no
 * region is always whole-file, regardless of the toggle.
 */
export function buildEditSpec(
  state: ExportDialogState,
  region: Region | null,
  sourceDurationSec: number,
): EditSpec {
  const trim =
    state.trimToRegion && region
      ? (() => {
          const { startSec, endSec } = regionToSeconds(
            region,
            sourceDurationSec,
          )
          return { startSec, endSec }
        })()
      : null

  return {
    trim,
    format: state.format,
    ...(state.sampleRate !== undefined ? { sampleRate: state.sampleRate } : {}),
    ...(state.channels !== undefined ? { channels: state.channels } : {}),
    ...(state.normalize ? { normalize: true } : {}),
  }
}

/**
 * The name the export dialog pre-fills: `"<source name> Edited"`, or the next
 * free `"<source name> Edited (N)"` once that is taken by an existing Edit of
 * this same parent. This is purely the dialog's OWN default — distinct from
 * `createEdit`'s bare `edited` / `edited (N)` fallback for an Edit that is
 * never given a custom name at all (`src/core/edits/editName.ts`); the dialog
 * always writes this default back as a `setCustomName` unless the user
 * changes it, so the core's own fallback in practice never surfaces.
 */
export function suggestedExportName(
  sourceName: string,
  existingNames: readonly string[],
): string {
  const base = `${sourceName} Edited`
  const taken = new Set(existingNames)
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base} (${n})`)) n++
  return `${base} (${n})`
}
