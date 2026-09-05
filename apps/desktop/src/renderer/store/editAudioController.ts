let el: HTMLAudioElement | null = null
let region: { startSec: number; endSec: number } | null = null
let onEnded: (() => void) | null = null
let rafId = 0

/** Every registered playhead DOM node, written at 60fps while playing. */
const playheadNodes = new Set<HTMLElement>()

function frame(): void {
  const a = el
  if (a && !a.paused) {
    if (region && a.currentTime >= region.endSec) {
      a.currentTime = region.startSec
    }
    if (a.duration > 0) {
      const value = String(a.currentTime / a.duration)
      for (const node of playheadNodes) node.style.setProperty('--playhead', value)
    }
  }
  rafId = requestAnimationFrame(frame)
}

function startRaf(): void {
  if (rafId === 0 && typeof requestAnimationFrame !== 'undefined') {
    rafId = requestAnimationFrame(frame)
  }
}

function stopRaf(): void {
  if (rafId !== 0 && typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(rafId)
  }
  rafId = 0
}

function ensureEl(): HTMLAudioElement | null {
  if (el) return el
  if (typeof Audio === 'undefined') return null
  const a = new Audio()
  a.addEventListener('playing', startRaf)
  a.addEventListener('pause', stopRaf)
  a.addEventListener('ended', () => {
    stopRaf()
    onEnded?.()
  })
  el = a
  return a
}

/** Turn an absolute filesystem path into a `file://` URL an `<audio>` element can stream. */
export function toFileUrl(path: string): string {
  const normalised = path.replace(/\\/g, '/')
  const withLeadingSlash = normalised.startsWith('/')
    ? normalised
    : `/${normalised}`
  return `file://${withLeadingSlash
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')}`
}

/** Load the local Original and seek to `startSec`, but do not start playing yet. */
export function loadRegion(
  filePath: string,
  r: { startSec: number; endSec: number },
): void {
  const a = ensureEl()
  region = r
  if (!a) return
  a.loop = false
  a.src = toFileUrl(filePath)
  a.load()
  a.currentTime = r.startSec
}

/** Update the loop bounds of an already-loaded region without reloading the file. */
export function setRegion(r: { startSec: number; endSec: number }): void {
  region = r
  if (el && (el.currentTime < r.startSec || el.currentTime > r.endSec)) {
    el.currentTime = r.startSec
  }
}

export function play(): void {
  void el?.play().catch(() => {})
}

export function pause(): void {
  el?.pause()
}

export function seekSec(sec: number): void {
  if (el) el.currentTime = sec
}

export function stop(): void {
  stopRaf()
  if (el) {
    el.pause()
    el.removeAttribute('src')
    el.load()
  }
  region = null
}

export function setCallbacks(cbs: { onEnded?: () => void }): void {
  onEnded = cbs.onEnded ?? null
}

export function isPlaying(): boolean {
  return !!el && !el.paused
}

/**
 * Register a DOM node to receive the 60fps `--playhead` write (0..1 of the
 * whole file) while this controller's element is playing. Mirrors
 * `audioController.registerPlayheadNode` — see that module for why this lives
 * outside React state.
 */
export function registerPlayheadNode(node: HTMLElement): void {
  playheadNodes.add(node)
  node.style.setProperty(
    '--playhead',
    el && el.duration > 0 ? String(el.currentTime / el.duration) : '0',
  )
}

export function unregisterPlayheadNode(node: HTMLElement): void {
  playheadNodes.delete(node)
}

/** Test-only: tear down the singleton between cases. */
export function __resetForTest(): void {
  stop()
  el = null
  onEnded = null
  playheadNodes.clear()
}
