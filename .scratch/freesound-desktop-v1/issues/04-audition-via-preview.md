# 04 — Audition via Preview

**What to build:** A sound designer presses play on a search result and hears it
immediately, then walks down the list by ear alone without touching the mouse.

Auditioning streams the [Preview](../../../CONTEXT.md) — the lossy public rendition that
needs no authentication and does not count as a download. Playback must start essentially
instantly even on a slow connection, which means streaming rather than waiting for a
complete file.

Playback state must live outside the list's render path. A playhead updating at 60fps must
not re-render rows; getting this wrong is the most likely way this feature makes the whole
app feel slow.

**Blocked by:** 03 — Result rows and virtualized list.

**Status:** ready-for-agent

- [ ] Pressing play on a result starts audible playback essentially immediately.
- [ ] Playback streams the Preview rather than waiting for a full download.
- [ ] Starting one Sound stops whatever is currently playing; two Sounds never overlap.
- [ ] A playhead moves across the row's waveform during playback.
- [ ] Clicking anywhere on the waveform seeks to that position.
- [ ] Keyboard shortcuts audition the next and previous result, and toggle play/pause.
- [ ] An auto-advance option plays the next result when the current one finishes.
- [ ] Volume is adjustable within the app, independently of system volume, and is remembered.
- [ ] A Sound can be looped while auditioning.
- [ ] A Preview that fails to load reports the failure on its row rather than appearing to hang.
- [ ] Playhead updates do not cause list rows to re-render, verified by profiling.
- [ ] A [Preview](../../../CONTEXT.md) is used for audition only and is never written to the content store or offered for [Drag-Out](../../../CONTEXT.md).
