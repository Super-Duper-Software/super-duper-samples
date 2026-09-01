# 04 — Rail result row

**What to build:** When the window is in the rail layout, each result row collapses to two
short lines so many Sounds fit in a thin strip. Play, the name and a `⋯` menu on top; a
small waveform, duration, format and one state token below. Everything else lives in `⋯`.
Dragging a Sound out of a rail row into a DAW still works.

**Blocked by:** 01 — Breakpoint infrastructure; 03 — Result row minimalism (wide layout).

**Status:** ready-for-agent

- [ ] When `isRail` is true, a result row renders two lines: line 1 = play icon · name (truncate, fills width) · `⋯`; line 2 = small waveform (~`h-6 w-16`) · duration · format · one state token · read-only custom-tag chips (overflow hidden).
- [ ] The one state token is whichever applies: staging chip / `✓ Downloaded` / `⚠ NC`. A non-commercial Sound always shows the `⚠ NC` token on line 2.
- [ ] The rail row `⋯` contains everything not on the two lines: Edit, Remove (variant-appropriate), Add to collection, Rename, Reveal, Open Freesound page, and the licence detail.
- [ ] The multi-select checkbox is not shown inline in rail; a "Select" toggle in `⋯` drives the same multi-select state the batch add-to-collection bar reads.
- [ ] Whole-row drag-out works from a rail row exactly as in the wide layout.
- [ ] Row keyboard navigation still works in the rail layout.
- [ ] Switching the window across 760px swaps a row between the wide and rail forms live, with no reload.
- [ ] `tsc --noEmit` and `electron-vite build` clean. Manual check at the 360px floor across search, Library and Collection lists, including drag-out.
