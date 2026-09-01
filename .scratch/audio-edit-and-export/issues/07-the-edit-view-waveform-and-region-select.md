# 07 — The Edit view: waveform + region select + loop-audition

**What to build:** The full-window **Edit view**. A sound designer opens it from a Library
Sound whose Original is on disk and sees the Sound's full-height waveform. They can zoom it,
click-drag to mark a region, nudge either edge, read the region's start / end / duration,
clear it, and loop-audition just that region to check the cut points. Closing the view
leaves everything untouched — no Edit is produced here (that is ticket 08).

Per spec 0001 there are no renderer component tests: the pure geometry helpers are
unit-tested, the view itself is verified by hand.

**Blocked by:** 03 — Computed waveform peaks for an Edit; 04 — Drag an Edit out into a DAW.

**Status:** ready-for-agent

- [ ] A new full-bleed shell view is added to the shell-view union and the persisted shell state, reachable from an "Edit" affordance on a Library row and/or the transport bar.
- [ ] The affordance is only offered for a Sound whose Original is on disk; for one not yet downloaded the user is told to download it first rather than shown a dead control.
- [ ] The view shows the Sound's computed-peaks waveform at full height, with wheel-zoom and double-click-to-reset reusing the existing waveform-peaks helpers.
- [ ] A top-right close control and the Escape key both dismiss the view; dismissing commits nothing.
- [ ] Pointer-drag across the waveform paints a region shown as a highlighted band with the rest dimmed; either edge can be dragged to adjust it; there is a clear-region control.
- [ ] The region's start time, end time and resulting duration are displayed and update live as the edges move.
- [ ] A region-audition control loops playback over `[start, end]` by binding to the audio element's time updates in the audio controller, playing the local Original directly (not the Preview), independent of the row-list transport.
- [ ] Region ↔ fraction geometry is a pure module with unit tests, prior art `test/waveform-peaks.test.ts`.
- [ ] Manual verification notes are recorded (open/close, zoom, drag-select feel, edge nudge, loop audition) alongside the existing drag-out findings.
