# Progress

Tracer-bullet backlog: `.scratch/freesound-desktop-v1/`. Ticket 09 (the milestone) is
built and its macOS drag-out was manually verified by the user on 2026-08-30. Tickets 10
(sidecars + LRU eviction) and 11 (Library save / view / delete) are done. Frontier is now
tickets 12 and 15.

| # | Ticket | State | Commit |
|---|---|---|---|
| 01 | Drag-out platform spike | **spike built; icon bug found & fixed; manual GUI drag test NOT yet run** (see SETUP.md §5) | `f16f812`, `812d81d` |
| 02 | App skeleton + first search | done | `f16f812` |
| 03 | Result rows + virtualized list | done | `812d81d` |
| 04 | Audition via Preview | done | `921ada0` |
| 05 | SQLite + search cache | done | `533c010` |
| 06 | Token-exchange Worker | done (not deployed — SETUP.md §3) | `f16f812` |
| 07 | OAuth sign-in / sign-out | done (needs Worker + Freesound app to exercise) | `0a502cb` |
| 08 | Staged download on audition | done | `4ed08ee` |
| 09 | Real drag-out — **the milestone** | **done** — code + tests + macOS manual verification (`docs/findings/0002`); Windows §B still outstanding | `0ee382b` |
| 10 | Sidecars + LRU eviction | **done** — code + tests (`test/eviction.test.ts`) | `0fed16b` |
| 11 | Library: save, view, delete | **done** — code + tests (`test/library.test.ts`) | _this commit_ |
| 12–19 | Peaks, collections, manifest, packaging | not started | — |

## Test counts

- `apps/desktop`: 113 vitest tests (+8 for ticket 11), `tsc --noEmit` clean, `electron-vite build` clean.
- `worker`: 30 vitest tests, `tsc --noEmit` clean.
- `spike/drag-out`: syntax-checked only (throwaway).

## Ticket 11 — what landed

- **Save is a row, not a file move.** `src/core/db/library.ts` — `library_entries`
  access:
  - `saveLibraryEntry(db, id, now)` — `INSERT … ON CONFLICT DO NOTHING` (idempotent;
    `saved_at` never moves, no duplicate) AND, in the same transaction, deletes any
    `staged_entries` row for that id. The Original on disk is untouched — the bytes
    just change intent-bucket (Staged → Library), which is why saving is instant
    (ADR-0003). This also keeps `getDiskUsage`'s staged/library split correct.
  - `deleteLibraryEntry`, `listLibrarySoundIds(db, dir)` (`ORDER BY saved_at`,
    default `desc` = newest-saved first), `libraryMembership(db, ids)` (one indexed
    `IN (…)` query → `{ [id]: boolean }` for every id asked about).
- `src/core/staging/eviction.ts` — extracted `removeContentFiles(dataDir, sound)`
  (Original first, then sidecar; touches no DB row) so `deleteFromLibrary` and
  staging eviction share the same unlink pattern. Eviction's own `removeStaged` and
  its tests are unchanged.
- `src/core/index.ts` — new commands:
  - `saveToLibrary(soundId, sound?)` — upserts the passed `Sound` metadata, then
    `saveLibraryEntry`. Throws if there is no metadata and none was passed.
  - `getLibraryMembership(ids)` → `Record<number, boolean>`.
  - `listLibrary({ sort?: 'savedAt'; dir?: 'asc'|'desc' })` → `Sound[]`, served
    entirely from `sounds` + `library_entries` — **no gateway call**, works offline
    and signed out.
  - `deleteFromLibrary(soundId)` — drops the row AND unlinks Original + sidecar;
    keeps the `sounds` row so the Sound can reappear as a plain search result.
  - `getContentPath(soundId)` / `getFreesoundUrl(soundId)` — pure data for the
    main-process `shell` calls below.
- `src/main/index.ts` — two **named** ipc handlers (mirroring `core:search`):
  `core:revealInFinder` → `shell.showItemInFolder(core.getContentPath(id))`,
  `core:openExternal` → `shell.openExternal(core.getFreesoundUrl(id))`. `shell`
  cannot live in core; the core supplies only the path / URL.
- `src/preload/index.ts` — `saveToLibrary` / `getLibraryMembership` / `listLibrary` /
  `deleteFromLibrary` via the generic `core:invoke` passthrough; `revealInFinder` /
  `openFreesoundPage` on the two named channels.
- Renderer:
  - `src/renderer/store/useLibrary.ts` — Zustand mirror of membership + `save` /
    `remove` actions; `selectRowLibrary(id)` + `useShallow` so only the flipped row
    re-renders (same pattern as `useStaging`).
  - `src/renderer/hooks/useLibraryView.ts` — loads `listLibrary` for the Library
    tab; re-fetches on tab-activate, on sort-dir change, and on `useLibrary.revision`
    (a save/remove happened). No paging, no gateway.
  - `src/renderer/components/ResultRow.tsx` — a `♥ saved` badge on search rows
    already in the Library; a `variant="library"` mode with per-row **Reveal /
    Page / Remove** buttons. Audition + drag behaviour is completely unchanged, so
    Library rows play and drag out exactly like search rows.
  - `src/renderer/components/ResultList.tsx` — `s` / `S` on the selected row saves
    it; `Delete` / `Backspace` in the Library variant calls `onRemove` for the
    selected row.
  - `src/renderer/App.tsx` — a Search / Library tab toggle in the header; the
    Library view reuses the same virtualized `ResultList`, with a Newest/Oldest
    sort button and a `window.confirm` before every delete.
- `test/library.test.ts` — 8 tests: save promotes a Staged Sound with the **same
  inode + path** (nothing moved) and `staged_entries` → `library_entries`; save is
  idempotent (one row, `saved_at` unchanged); save throws with no metadata;
  `listLibrary` newest-first / `dir:'asc'`; membership true for saved + false for
  the rest, every id present; delete removes the row AND Original + sidecar while
  keeping the `sounds` row; the whole Library lists / serves paths for / deletes a
  Sound with a **gateway whose every method rejects**, and survives a reopen.

### Deferrals / judgement calls (ticket 11)

- **No migration.** `library_entries` already exists from m001 with
  `(sound_id, custom_name, custom_tags, saved_at)` — save/view/delete needs no
  schema change. `MIGRATIONS` is still `[m001, m002]`.
- **`custom_name` / `custom_tags` left NULL** — user-overlay names/tags are
  **ticket 13**, not built here.
- **Collections not built** — **ticket 16**.
- **Delete confirm is `window.confirm`** — the ticket explicitly allows it for v1;
  an inline affordance can come later.
- **Multi-select delete / bulk save** not built — no multi-select UI until ticket
  13 (matches the ticket-09 note).
- **`s` keystroke chosen** for save (list-scoped handler, inert while the search
  input is focused). Delete is `Delete`/`Backspace`, Library view only.

## Ticket 10 — what landed

- `src/core/staging/eviction.ts` — the eviction/accounting seam:
  - `evictStagedOverBudget(db, dataDir, byteBudget, inFlightDrags)` — sums
    `staged_entries.byte_size`, and while over budget removes
    least-recently-accessed Staged Sounds first (`listStagedEntries` is already
    `ORDER BY last_access_at ASC`). Each removal is whole: Original unlinked
    FIRST, then the sidecar, then the `staged_entries` row — an interrupted pass
    can only ever leave a harmless sidecar-without-audio, never the reverse.
  - Never evicts a Sound with a `library_entries` row or one flagged by
    `InFlightDrags` — reported in `skipped`, never forced out.
  - `clearStaged(...)` — same removal, no budget, for `core.clearStaged()`.
  - `computeDiskUsage(db, dataDir)` — `{ staged, library, total }`; Library bytes
    by stat-ing each Library Original (no size column, schema stays append-only).
  - `DEFAULT_STAGING_BYTE_BUDGET = 2 GiB`.
- `src/core/staging/dragRegistry.ts` — `createDragRegistry()`: a ref-counted set
  of Sound ids with a live Drag-Out, each entry self-expiring after a 120 s TTL
  (unref'd timer) so a missed `dragend` can never pin a Sound forever. This is
  the `InFlightDrags` seam eviction consults.
- `src/core/staging/dragController.ts` — `startDrag` now calls
  `dragRegistry.begin(soundIds)` after handing the drag to the OS.
- `src/core/staging/stagingController.ts` — after `onComplete` writes the new
  `staged_entries` row it calls `scheduleEviction()`, which runs the pass on
  `setImmediate` (off the audition hot path, coalesced, fully async, failures
  swallowed — the user is never told). Adds `getDiskUsage()` / `clearStaged()`.
  New deps: `byteBudget`, `inFlightDrags`.
- `src/core/index.ts` — `CoreDeps.stagingByteBudget?`; constructs the shared
  `dragRegistry` and threads it into staging + drag; new commands
  `getDiskUsage()`, `clearStaged()`, `endDrag(soundIds)`; `close()` clears the
  registry.
- `src/preload/index.ts` — `getDiskUsage` / `clearStaged` / `endDrag` on the
  bridge (`core:invoke` passthrough — no `src/main` change needed).
- `src/renderer/components/ResultRow.tsx` — `onDragEnd` calls
  `window.core.endDrag([sound.id])` so the eviction-skip hold is released
  whatever the drop outcome.
- `test/eviction.test.ts` — 11 tests covering every bullet of the ticket's
  "Tests cover:" line (sidecar accompanies every download; budget exceeded →
  LRU-first eviction, both via the pure function and via the live audition path;
  skips Library Sounds; skips live-hardlink Sounds; audio + sidecar removed
  together; `clearStaged` leaves the Library untouched) plus `getDiskUsage`
  split and the zero case.

### Deferrals / judgement calls (ticket 10)

- **No new migration.** The ticket allowed appending `m003` for a Library size
  column; not needed — `staged_entries.byte_size` already exists and Library
  bytes are cheap to stat (row count is tiny; `library_entries` is still empty
  until ticket 11).
- **Eviction is not a worker thread** (the ticket said one is not required). It
  is async `node:fs` work on `setImmediate`; revisit with the other main-thread
  offloads noted for ticket 18 if staging ever holds thousands of rows.
- **In-flight-drag TTL is 120 s.** Belt-and-braces only — the renderer's
  `dragend` is the real signal; the hardlink already keeps a dropped file alive
  after eviction (`docs/findings/0002` §A7).
- `<userData>/drag/` hardlinks are still never swept (unchanged from ticket 09 —
  ticket 18).

## Ticket 09 — what landed

- `src/core/staging/dragHost.ts` — `DragHost` boundary + `createRecordingDragHost` (test fake).
- `src/core/staging/dragController.ts` — `startDrag()`: resolves Sounds, refuses any whose
  Original is not on disk (`OriginalNotStagedError` — never a Preview), hardlinks each
  Original into `<userData>/drag/` under a sanitised name with `(2)`, `(3)` collision
  disambiguation, resolves a never-empty icon, calls `DragHost` once.
- `src/core/index.ts` — `core.startDrag()` + `core.getDragCapabilities()`; new
  `dragHost` / `dragIconFallbackPath` deps.
- `src/main/dragHost.ts` — production `DragHost` over `webContents.startDrag`;
  `multiFileDragSupported = darwin only` (electron#9019).
- `src/main/index.ts` — constructs it; resolves `resources/drag-icon.png`.
- `src/preload/index.ts` — `startDrag` / `getDragCapabilities` on the bridge.
- `src/renderer/components/ResultRow.tsx` — every row `draggable`; `dragstart` sends the
  Sound's waveform as the drag icon and shows a visible message when refused.
- `src/renderer/lib/dragIcon.ts` — best-effort waveform-PNG → data URL.
- `apps/desktop/resources/drag-icon.png` + `scripts/make-drag-icon.mjs` — bundled fallback glyph.
- `test/drag.test.ts` — 9 tests covering every item in the ticket's test list.

## Still open for ticket 09

- **Run `docs/findings/0002` §A/§B/§C/§D** on real macOS + Windows against Logic /
  Audacity / Final Cut / Ableton / the file manager. The milestone is not proven until
  §A is green.
- Multi-Sound drag is core-ready + gated but not surfaced (no multi-select UI until 13).
- `<userData>/drag/` is never swept — deferred to ticket 18.
- Fallback icon into `electron-builder` `extraResources` — ticket 19.

## Known follow-ups noted by the ticket agents

- Rate-limit question (SETUP.md §2) must be answered before shipping OAuth.
- `better-sqlite3` needs a rebuild on Node/Electron ABI changes (ticket 19 / `@electron/rebuild`).
- Renderer bundle is ~620 kB and unsplit — fine for an Electron app, revisit at ticket 18.
- Hand-crafted Freesound fixtures (`apps/desktop/test/fixtures/freesound/`) should be
  re-recorded against a real API key.
