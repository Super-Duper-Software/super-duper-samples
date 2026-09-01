# Responsive Rail Layout — tickets

Six tickets derived from [spec 0003](../../docs/specs/0003-responsive-rail-layout.md).
Vocabulary is defined in [CONTEXT.md](../../CONTEXT.md); constraints in
[docs/adr/](../../docs/adr/), in particular
[ADR-0006](../../docs/adr/0006-a-thin-rail-layout-for-docked-use.md) (the 760px flip
point, `useViewport` over CSS, and the "`⋯` is the overflow" principle). The Edit view
([ADR-0005](../../docs/adr/0005-an-edit-is-a-derived-local-sound.md)) is out of scope and
unchanged.

Work the **frontier** — any ticket whose blockers are all complete. Take one at a time
with `/implement`, clearing context between tickets.

## Dependency graph

```
01 breakpoint infra ──┬───────────────── 04 rail result row
                      │                   (also blocked by 03)
                      ├── 05 header: rail + wide hardening
                      └── 06 transport / filter / sub-bars + "Credits"

02 OverflowMenu ──────┬── 03 result row minimalism (wide) ── 04 rail result row
                      ├── 05 header: rail + wide hardening
                      └── 06 transport / filter / sub-bars + "Credits"
```

01 and 02 have no blockers and can go in parallel. Once both land, 03 / 05 / 06 open
together; 04 opens after 03.

## Ticket index

| # | Ticket | Blocked by |
|---|---|---|
| 01 | Breakpoint infrastructure | — |
| 02 | `OverflowMenu` primitive | — |
| 03 | Result row minimalism (wide layout) | 02 |
| 04 | Rail result row | 01, 03 |
| 05 | Header — rail structure + wide hardening | 01, 02 |
| 06 | Transport, FilterBar, sub-bars + "Credits" rename | 01, 02 |

## Notes

- **No renderer component tests, no jsdom/Playwright** — per spec 0001, unchanged here.
  Ticket 01 carries the only automated tests: a unit test on the `layoutForWidth` pure
  helper and an updated window-bounds boundary case in `test/shell-polish.test.ts`.
- Everything visual is manual GUI verification. Add a checklist to `PROGRESS.md`
  "Needs manual verification" as tickets 03, 05 and 06 land (they each change the wide
  layout users see). Prior art: `docs/findings/0002-drag-out-manual-verification.md`.
- The `brand/logo.svg` asset is not part of this work — ticket 05 wires an `<img>` slot
  that renders empty until the artwork lands separately.
- "Credits" is a UI label only; the artifact, code and docs keep the term
  **Attribution Manifest**. CONTEXT.md already records the split.
