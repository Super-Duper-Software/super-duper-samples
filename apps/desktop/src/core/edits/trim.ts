// Pure helper: validate + clamp an EditSpec's trim window against the parent
// Sound's own duration (ticket 02). No I/O — `createEdit` calls this before
// any render starts, so an invalid region never reaches the runner.

import type { EditSpec } from '../types'

/** A trim region that is empty (or negative) once clamped to the source. */
export class InvalidTrimError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidTrimError'
  }
}

/**
 * `null` in, `null` out (whole file). Otherwise clamps both bounds to
 * `[0, sourceDurationSec]` and throws {@link InvalidTrimError} if the clamped
 * region is zero-length or inverted.
 */
export function resolveTrim(
  sourceDurationSec: number,
  trim: EditSpec['trim'],
): { startSec: number; endSec: number } | null {
  if (trim === null) return null

  const startSec = Math.min(Math.max(trim.startSec, 0), sourceDurationSec)
  const endSec = Math.min(Math.max(trim.endSec, 0), sourceDurationSec)

  if (endSec <= startSec) {
    throw new InvalidTrimError(
      `Trim region [${trim.startSec}, ${trim.endSec}] is empty once clamped to the source's ${sourceDurationSec}s duration.`,
    )
  }

  return { startSec, endSec }
}
