// Pure helpers for drawing a computed-peak waveform to a <canvas> (ticket 12).
//
// The core hands the renderer a fixed base envelope: `bucketCount` min/max pairs
// covering the whole Original, values in [-1, 1]. To draw at an arbitrary pixel
// width, and for an arbitrary zoom WINDOW [start, end] (a sub-range of 0..1 of
// the file), we resample that base envelope into exactly one min/max pair per
// output column, taking the extreme over every base bucket the column spans.
// No recompute, no core round-trip — resize and zoom are pure client math.

export interface PeakColumn {
  /** Minimum sample value across this column, in [-1, 1]. */
  min: number
  /** Maximum sample value across this column, in [-1, 1]. */
  max: number
}

export interface PeakEnvelope {
  bucketCount: number
  /** Interleaved `[min0, max0, min1, max1, ...]`, length `bucketCount * 2`. */
  peaks: readonly number[]
}

/**
 * Resample `env` into `columns` min/max pairs across the normalised window
 * `[start, end]` (each in [0, 1], `start < end`). A column that lands between two
 * base buckets still reports that bucket's extent, so zooming in never shows
 * gaps — it shows the base grid getting blocky, which is the honest limit of the
 * cached resolution.
 */
export function resamplePeaks(
  env: PeakEnvelope,
  columns: number,
  start = 0,
  end = 1,
): PeakColumn[] {
  const out: PeakColumn[] = []
  const n = env.bucketCount
  if (n <= 0 || columns <= 0) return out
  const lo = clamp01(Math.min(start, end))
  const hi = clamp01(Math.max(start, end))
  const span = Math.max(hi - lo, 1e-6)

  for (let col = 0; col < columns; col++) {
    const f0 = lo + (span * col) / columns
    const f1 = lo + (span * (col + 1)) / columns
    let b0 = Math.floor(f0 * n)
    let b1 = Math.ceil(f1 * n)
    if (b0 < 0) b0 = 0
    if (b1 > n) b1 = n
    if (b1 <= b0) b1 = Math.min(n, b0 + 1)

    let min = 1
    let max = -1
    for (let b = b0; b < b1; b++) {
      const mn = env.peaks[b * 2] ?? 0
      const mx = env.peaks[b * 2 + 1] ?? 0
      if (mn < min) min = mn
      if (mx > max) max = mx
    }
    if (min > max) {
      min = 0
      max = 0
    }
    out.push({ min, max })
  }
  return out
}

export interface DrawOptions {
  /** CSS pixel size of the canvas box. */
  width: number
  height: number
  /** `window.devicePixelRatio` — the canvas backing store is scaled by this for a sharp line at any width. */
  dpr: number
  /** Normalised zoom window over the file, each in [0, 1]. Defaults to the whole file. */
  windowStart?: number
  windowEnd?: number
  /** Filled body colour and the centre-line colour. */
  color: string
  midColor?: string
}

/**
 * Draw the envelope to a 2D context. Sizes the backing store to
 * `width*dpr x height*dpr` so the waveform is crisp on HiDPI and at any CSS
 * width. Safe to call every animation of a resize/zoom — it is a full repaint of
 * a few hundred rects.
 */
export function drawPeakWaveform(
  canvas: HTMLCanvasElement,
  env: PeakEnvelope,
  opts: DrawOptions,
): void {
  const { width, height, dpr, color } = opts
  const w = Math.max(1, Math.round(width * dpr))
  const h = Math.max(1, Math.round(height * dpr))
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)

  const columns = Math.max(1, Math.round(width))
  const cols = resamplePeaks(
    env,
    columns,
    opts.windowStart ?? 0,
    opts.windowEnd ?? 1,
  )
  const colW = w / columns
  const mid = h / 2

  if (opts.midColor) {
    ctx.fillStyle = opts.midColor
    ctx.fillRect(0, Math.floor(mid), w, 1)
  }

  ctx.fillStyle = color
  for (let i = 0; i < cols.length; i++) {
    const { min, max } = cols[i]!
    const yTop = mid - max * mid
    const yBot = mid - min * mid
    const x = Math.floor(i * colW)
    const barW = Math.max(1, Math.ceil(colW))
    // At least 1px tall so silence still reads as a line, not a gap.
    ctx.fillRect(x, Math.floor(yTop), barW, Math.max(1, Math.ceil(yBot - yTop)))
  }
}

/**
 * Map a pointer x within the waveform box (0..1 of its width) to a fraction of
 * the WHOLE file, honouring the current zoom window. Used for click / drag seek
 * so scrubbing is accurate while zoomed.
 */
export function pointerToFraction(
  xFraction: number,
  windowStart = 0,
  windowEnd = 1,
): number {
  const lo = clamp01(Math.min(windowStart, windowEnd))
  const hi = clamp01(Math.max(windowStart, windowEnd))
  return clamp01(lo + clamp01(xFraction) * (hi - lo))
}

/**
 * Apply a zoom step centred on `focusFraction` (0..1 of the current window).
 * `factor < 1` zooms in, `> 1` zooms out. The window is clamped to [0, 1] and to
 * a minimum span so it can never invert or vanish.
 */
export function zoomWindow(
  windowStart: number,
  windowEnd: number,
  factor: number,
  focusFraction: number,
  minSpan = 0.02,
): { start: number; end: number } {
  const lo = clamp01(Math.min(windowStart, windowEnd))
  const hi = clamp01(Math.max(windowStart, windowEnd))
  const span = hi - lo
  const focusAbs = lo + clamp01(focusFraction) * span
  let newSpan = span * factor
  if (newSpan > 1) newSpan = 1
  if (newSpan < minSpan) newSpan = minSpan
  let start = focusAbs - (focusAbs - lo) * (newSpan / span)
  let end = start + newSpan
  if (start < 0) {
    start = 0
    end = newSpan
  }
  if (end > 1) {
    end = 1
    start = 1 - newSpan
  }
  return { start, end }
}

/**
 * Slide the zoom window by `deltaFraction` (of the WHOLE file), keeping its
 * span fixed — a horizontal scroll while zoomed in. Clamped so the window
 * stays inside [0, 1] and never changes width, even at an edge (ticket 07:
 * without this, zooming in on the Edit view has no way to reach the rest of
 * the file).
 */
export function panWindow(
  windowStart: number,
  windowEnd: number,
  deltaFraction: number,
): { start: number; end: number } {
  const lo = clamp01(Math.min(windowStart, windowEnd))
  const hi = clamp01(Math.max(windowStart, windowEnd))
  const span = hi - lo
  let start = lo + deltaFraction
  let end = hi + deltaFraction
  if (start < 0) {
    start = 0
    end = span
  }
  if (end > 1) {
    end = 1
    start = 1 - span
  }
  return { start, end }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}
