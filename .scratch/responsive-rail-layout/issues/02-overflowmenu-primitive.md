# 02 — `OverflowMenu` primitive

**What to build:** A single reusable `⋯` menu component that any bar or row can use to
shed the actions it cannot show. It is the one mechanism the rest of this feature leans
on; it has no consumer of its own yet and is proven on first use in ticket 03.

Modelled on the existing `CollectionMenu` portal/positioning approach, so the codebase
has one menu style, not two.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] An `OverflowMenu` renderer component renders a trigger button (`⋯`, `aria-haspopup="menu"`) and, when open, a portal-rendered `role="menu"` list of caller-supplied items.
- [ ] Keyboard: arrow keys move between items, Home/End jump to first/last, Enter/Space activate, Escape closes.
- [ ] The menu closes on Escape, on outside-click, and after an item runs — except for an item that opens a nested picker (e.g. "Add to collection" opening `CollectionMenu`), which leaves the flow open.
- [ ] Focus returns to the trigger when the menu closes.
- [ ] The menu is anchored below-right of the trigger and flips above when there is not enough room below.
- [ ] The menu is portal-rendered so it is not clipped by a row's `overflow-hidden`.
- [ ] Items can carry a destructive style (e.g. Remove) and can be individually disabled.
- [ ] `CollectionMenu` and `FilterPopover` are untouched.
- [ ] `tsc --noEmit` and `electron-vite build` are clean. Per spec 0001 there is no component test; a short manual check in a scratch mount, or deferring verification to ticket 03's real usage, is acceptable.
