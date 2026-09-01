# 01 — Breakpoint infrastructure

**What to build:** The shell gains the single mechanism that decides between the "wide"
and "rail" layouts, and the window can be dragged narrower than before. Nothing about the
visible layout changes yet — this ticket only lays the seam every later ticket branches
on.

A pure helper answers "which layout for this width?", a renderer hook exposes that as a
live boolean, and the minimum window width drops so a genuinely thin strip is possible.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A pure helper `layoutForWidth(width: number): 'wide' | 'rail'` exists, with an exported `RAIL_MAX_WIDTH = 760`; width ≤ 760 is `rail`, width ≥ 761 is `wide`.
- [ ] A `useViewport()` renderer hook exposes `isRail: boolean`, backed by a single `matchMedia('(max-width: 760px)')` listener held in one place.
- [ ] `useViewport()` reads its initial value synchronously so the first paint is already in the correct layout — no wide→rail flash on launch in a narrow window.
- [ ] The `matchMedia` listener is removed on unmount and does not fire after teardown.
- [ ] `MIN_WINDOW_WIDTH` in `src/core/uiState.ts` is `360` (was `640`); `MIN_WINDOW_HEIGHT` is unchanged at `480`.
- [ ] The main-process `BrowserWindow` `minWidth` and the saved-bounds clamp both reflect the new floor (they already read the constant — confirm no separate literal exists).
- [ ] `normaliseUiState` still rejects a saved window narrower than 360 or off-screen; a saved 360×480 window is now accepted.
- [ ] Unit test on `layoutForWidth` covers the 760/761 boundary exactly. Prior art: `test/region-geometry.test.ts`.
- [ ] `test/shell-polish.test.ts` window-bounds cases are updated to the 360 floor (360×480 accepted; sub-360 rejected) and pass.
- [ ] `tsc --noEmit` and `electron-vite build` are clean; no visible layout change in either a wide or a narrow window.
