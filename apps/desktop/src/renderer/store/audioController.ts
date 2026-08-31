// ─────────────────────────────────────────────────────────────────────────────
// THE AUDIO-SOURCE BOUNDARY.
//
// This module is the ONLY place an audio source is attached to an output. It
// streams a Sound's PREVIEW — the lossy, public, no-auth rendition — for
// auditioning only.
//
// INVARIANT (ADR-0003 "Auditioning stages a download"; CONTEXT.md § Preview):
//   A Preview is NEVER written to disk, NEVER placed in the content store, and
//   NEVER made draggable. `audio.src` is set to a remote https URL and the
//   browser streams it; no bytes are persisted here. Ticket 08 adds the real
//   Original download that runs alongside auditioning — that is the artifact
//   that may be staged and dragged, and it is emphatically NOT handled here.
//   Dragging the Preview mp3 and swapping the Original in afterwards is
//   forbidden outright (ADR-0003 "Consequences").
// ─────────────────────────────────────────────────────────────────────────────
//
// A single long-lived HTMLAudioElement is created once and reused for every
// audition (never one element per row). Setting `.src` + calling `.play()` on
// the same element inherently stops whatever was playing, so two Sounds can
// never overlap.
//
// The 60fps playhead lives HERE, not in React and not in the Zustand store: a
// requestAnimationFrame loop reads `audio.currentTime` and writes a CSS custom
// property (`--playhead`) straight onto a DOM node the active row registered.
// The store only ever receives coarse transport events (playing / paused /
// ended / error). This is what keeps playhead motion off every row's render
// path (spec 0001 § Auditioning: "playback state must live outside the list's
// render path").

/** Coarse transport events pushed back into the Zustand store. */
export interface AudioCallbacks {
  onLoading: () => void
  onPlaying: () => void
  onPaused: () => void
  onEnded: () => void
  onError: (soundId: number) => void
}

const NOOP: AudioCallbacks = {
  onLoading: () => {},
  onPlaying: () => {},
  onPaused: () => {},
  onEnded: () => {},
  onError: () => {},
}

/** A `stalled` event that does not clear within this window is treated as a load failure. */
const STALL_TIMEOUT_MS = 8000

let el: HTMLAudioElement | null = null
let callbacks: AudioCallbacks = NOOP
let rafId = 0
let stallTimer: ReturnType<typeof setTimeout> | null = null

/** The sound id currently loaded into the element (source of truth for `error` attribution). */
let currentId: number | null = null

/**
 * True between `load()` and the first `playing` for that source. Swapping `.src`
 * on a playing element emits a transient `pause`; we swallow it so the store
 * does not flicker to 'paused' mid-switch.
 */
let switching = false

/**
 * Every registered playhead DOM node, mapped to the sound id it belongs to.
 * There can be more than one for the current sound at once — e.g. the result
 * row's inline waveform and the transport bar's larger zoomable waveform
 * (ticket 12). The rAF loop writes `--playhead` to every node whose id matches
 * the sound currently loaded.
 */
const playheadNodes = new Map<HTMLElement, number>()

export function setCallbacks(cb: AudioCallbacks): void {
  callbacks = cb
}

function clearStallTimer(): void {
  if (stallTimer != null) {
    clearTimeout(stallTimer)
    stallTimer = null
  }
}

function armStallTimer(): void {
  clearStallTimer()
  stallTimer = setTimeout(() => {
    stallTimer = null
    if (currentId != null && el != null && el.paused)
      callbacks.onError(currentId)
  }, STALL_TIMEOUT_MS)
}

function frame(): void {
  const a = el
  if (a && playheadNodes.size > 0 && a.duration > 0) {
    const value = String(a.currentTime / a.duration)
    for (const [node, id] of playheadNodes) {
      // Direct DOM write — no setState, no re-render. See module header.
      if (id === currentId) node.style.setProperty('--playhead', value)
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

function resetPlayhead(): void {
  for (const node of playheadNodes.keys()) {
    node.style.setProperty('--playhead', '0')
  }
}

/**
 * Lazily create the one shared element. Returns null in a non-DOM environment
 * (unit tests), so the store's actions stay callable without a browser.
 */
function ensureEl(): HTMLAudioElement | null {
  if (el) return el
  if (typeof Audio === 'undefined') return null

  const a = new Audio()
  a.preload = 'auto'

  a.addEventListener('playing', () => {
    switching = false
    clearStallTimer()
    startRaf()
    callbacks.onPlaying()
  })
  a.addEventListener('canplay', clearStallTimer)
  a.addEventListener('pause', () => {
    // `ended` also fires a `pause` (its handler owns that); a `.src` swap emits a
    // transient `pause` we swallow while `switching`.
    if (!a.ended && !switching) {
      stopRaf()
      callbacks.onPaused()
    }
  })
  a.addEventListener('ended', () => {
    stopRaf()
    resetPlayhead()
    callbacks.onEnded()
  })
  a.addEventListener('error', () => {
    switching = false
    stopRaf()
    clearStallTimer()
    if (currentId != null) callbacks.onError(currentId)
  })
  a.addEventListener('stalled', armStallTimer)
  a.addEventListener('waiting', armStallTimer)

  el = a
  return a
}

/**
 * Point the shared element at a Preview URL and start streaming it. Any Sound
 * that was playing stops here (same element).
 */
export function load(
  soundId: number,
  url: string,
  opts: { loop: boolean; volume: number },
): void {
  const a = ensureEl()
  currentId = soundId
  switching = true
  resetPlayhead()
  callbacks.onLoading()
  if (!a) return
  a.loop = opts.loop
  a.volume = opts.volume
  a.src = url // ← Preview stream. Never persisted. See module header / ADR-0003.
  a.load()
  void a.play().catch(() => {
    // Autoplay rejection or an unreachable Preview both surface as a failed row.
    if (currentId === soundId) callbacks.onError(soundId)
  })
}

export function resume(): void {
  const a = ensureEl()
  if (!a || !a.src) return
  void a.play().catch(() => {
    if (currentId != null) callbacks.onError(currentId)
  })
}

export function pause(): void {
  el?.pause()
}

export function stop(): void {
  switching = false
  stopRaf()
  clearStallTimer()
  resetPlayhead()
  if (el) {
    el.pause()
    el.removeAttribute('src')
    el.load()
  }
  currentId = null
}

export function seekFraction(fraction: number): void {
  const a = el
  if (!a || !(a.duration > 0)) return
  const f = Math.min(1, Math.max(0, fraction))
  a.currentTime = f * a.duration
  for (const [node, id] of playheadNodes) {
    if (id === currentId) node.style.setProperty('--playhead', String(f))
  }
}

export function setVolume(volume: number): void {
  if (el) el.volume = Math.min(1, Math.max(0, volume))
}

export function setLoop(loop: boolean): void {
  if (el) el.loop = loop
}

/**
 * A <Waveform> registers its playhead node here while it is the current sound,
 * and unregisters (by node) on unmount / when another sound takes over. Every
 * registered node whose sound id is the one playing is written by the rAF loop.
 */
export function registerPlayheadNode(soundId: number, node: HTMLElement): void {
  playheadNodes.set(node, soundId)
  node.style.setProperty(
    '--playhead',
    el && el.duration > 0 && soundId === currentId
      ? String(el.currentTime / el.duration)
      : '0',
  )
}

export function unregisterPlayheadNode(
  nodeOrSoundId: HTMLElement | number,
): void {
  if (typeof nodeOrSoundId === 'number') {
    for (const [node, id] of playheadNodes) {
      if (id === nodeOrSoundId) playheadNodes.delete(node)
    }
    return
  }
  playheadNodes.delete(nodeOrSoundId)
}

/** Test-only: tear down the singleton between cases. */
export function __resetForTest(): void {
  stop()
  el = null
  callbacks = NOOP
  playheadNodes.clear()
}
