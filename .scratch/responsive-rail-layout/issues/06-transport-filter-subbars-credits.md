# 06 — Transport, FilterBar, sub-bars + "Credits" rename

**What to build:** The remaining chrome gets pared back. The transport bar becomes one row
in the rail layout with its secondary controls in a `⋯` menu; the filter bar collapses to
two buttons; the Library and Collections sub-bars lose their explanatory sentences in both
layouts; and "Generate manifest" becomes "Credits".

**Blocked by:** 01 — Breakpoint infrastructure; 02 — `OverflowMenu` primitive.

**Status:** ready-for-agent

- [ ] **Rail `TransportBar`:** one row — play/pause · current-sound name (truncate) · `♥` glyph only (no "Support" text; tooltip kept) · `⋯` holding Stop, Loop, Auto-advance and the volume slider.
- [ ] The scrub waveform stays visible above the rail transport row, at ~`h-12`.
- [ ] Playback status ("Buffering…/Playing/Paused") is shown as a colour/spinner cue on the play button in rail, not as a fixed-width text column.
- [ ] The wide `TransportBar` is unchanged in content but does not wrap down to 760px (verify; adjust only if it does).
- [ ] **Rail `FilterBar`:** `Sort ▾` and `Filters ▾` as two equal-width buttons on one row; the active-filter chip row stays below and wraps; the fixed-width sort select becomes fluid.
- [ ] The Library sub-bar helper sentence and the Collections sub-bar trailing sentence are removed in **both** layouts.
- [ ] In the rail layout the Library and Collection sort-direction toggles become compact `↑`/`↓` icons; the `‹ All collections` breadcrumb and the open Collection name stay visible.
- [ ] "Generate manifest" is relabelled **"Credits"** in the UI (both layouts), staying a labelled button. The panel heading/output, code and docs keep the term "Attribution Manifest".
- [ ] Switching across 760px reflows the transport bar, filter bar and sub-bars live.
- [ ] `tsc --noEmit` and `electron-vite build` clean. Manual check at the 360px floor and ~900px; add these changes to `PROGRESS.md` "Needs manual verification".
