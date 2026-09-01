# 03 — Result row minimalism (wide layout)

**What to build:** At normal window width the result rows get quieter and finally line up.
Every row's trailing licence area becomes one fixed-width slot, so the buttons to its left
sit at the same place on every row. Each row shows only its one or two most important
actions; the rest move into a per-row `⋯` menu. Custom tags stop being an inline form and
Freesound's raw tag dump comes off the row.

This is the wide layout only — the rail row is ticket 04.

**Blocked by:** 02 — `OverflowMenu` primitive.

**Status:** ready-for-agent

- [ ] Each row has a fixed-width trailing licence slot (~`w-24`, right-aligned, always rendered) showing **either** the `⚠ Non-commercial` pill **or** the `LicenseChip`, never both.
- [ ] A non-commercial Sound still gets its own visually distinct pill (label + heavier border, per the `LicenseChip` brand rule) — it just occupies the shared slot.
- [ ] With the trailing slot a constant width, the visible action button(s) align from row to row across search, Library and Collection lists.
- [ ] **Search row:** `Download` / `✓ Downloaded` stays directly on the row. `⋯` contains "Open Freesound page" and "Add to collection" (replacing the inline `＋ Collection ▾`).
- [ ] **Library row:** `✂ Edit` stays directly on the row. `⋯` contains Add to collection, Rename, Reveal, Open Freesound page, and Remove (delete-from-Library); Remove is styled destructive inside the menu.
- [ ] **Collection row:** `✂ Edit` and `Remove from collection` stay directly on the row. `⋯` contains Add to collection, Rename, Reveal, Open Freesound page.
- [ ] Custom tags render as read-only chips (no inline `×`, no inline `+ tag` input). Adding and removing custom tags happens from `⋯` → "Edit tags" (and remains possible in the Edit view).
- [ ] Freesound's own tag list is removed from the row body and is available as a `title` tooltip.
- [ ] "Add to collection" from a row `⋯` opens the existing `CollectionMenu` and adds that single Sound without touching the batch multi-select bar.
- [ ] Row keyboard navigation and whole-row drag-out are unchanged.
- [ ] `tsc --noEmit` and `electron-vite build` clean. Manual check at normal width across all three list types; add the row changes to `PROGRESS.md` "Needs manual verification".
