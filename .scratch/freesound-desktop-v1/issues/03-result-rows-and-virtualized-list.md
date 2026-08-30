# 03 — Result rows and virtualized list

**What to build:** A sound designer can scan hundreds of search results smoothly and judge
each candidate without clicking into anything. Every row shows the
[Sound](../../../CONTEXT.md)'s waveform, name, author, duration, tags and
[License](../../../CONTEXT.md), and scrolling stays fluid at any result count.

Waveforms here come from Freesound's pre-rendered images, recoloured to the app's palette
via CSS masking — they cost no CPU and are available before anything is downloaded.

Windowing is not an optimisation to add later; a list of this density is unusable without
it. See [ADR-0001](../../../docs/adr/0001-electron-over-tauri.md) — responsiveness is the
application's responsibility, not the framework's.

**Blocked by:** 02 — App skeleton and first search.

**Status:** ready-for-agent

- [ ] Results render in a virtualized list, so DOM node count stays roughly constant regardless of how many results are loaded.
- [ ] Each row shows: waveform image, Sound name, author, duration, tags, and a License chip.
- [ ] Waveform images are recoloured to match the app theme rather than appearing as pasted-in images.
- [ ] Waveform images load lazily as rows come into view and are not re-requested on scroll-back.
- [ ] Scrolling a large result set stays smooth, with no visible stalling or blank rows under normal use.
- [ ] The total number of results for a query is shown.
- [ ] An empty result set states plainly that nothing matched and suggests loosening the query, and is visually distinct from a loading state.
- [ ] A loading state is shown while a query is in flight.
- [ ] Keyboard navigation moves selection up and down the list, scrolls the selection into view, and returns focus to the search box.
- [ ] Rows are keyboard-focusable and the selected row is clearly indicated.
- [ ] Tests at the core seam cover result shape and pagination; visual density and smoothness are verified manually.
