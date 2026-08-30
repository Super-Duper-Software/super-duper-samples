# Progress

Tracer-bullet backlog: `.scratch/freesound-desktop-v1/`. Ticket 09 (the milestone) is
built and its macOS drag-out was manually verified by the user on 2026-08-30. Tickets 10
(sidecars + LRU eviction), 11 (Library save / view / delete) and 15 (search filters +
sort) are done. Frontier is now ticket 12.

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
| 11 | Library: save, view, delete | **done** — code + tests (`test/library.test.ts`) | `6406a57` |
| 15 | Search filters and sort | **done** — code + tests (`test/search-filters.test.ts`) | `this commit` |
| 12–14, 16–19 | Peaks, collections, manifest, packaging | not started | — |

## Test counts

- `apps/desktop`: 139 vitest tests (+26 for ticket 15), `tsc --noEmit` clean, `electron-vite build` clean.
- `worker`: 30 vitest tests, `tsc --noEmit` clean.
- `spike/drag-out`: syntax-checked only (throwaway).

## Ticket 15 — what landed

- **Filter model** (`src/core/types.ts`, exported):
  - `SearchSort = 'relevance' | 'duration_asc' | 'duration_desc' | 'rating' | 'downloads' | 'created'`.
  - `SearchFilter` — all optional: `durationMin`, `durationMax` (seconds),
    `sampleRate`, `bitDepth`, `channels`, `fileType`, `license`.
  - `LicenseFilter = 'commercial' | 'cc0' | 'cc-by' | 'cc-by-nc' | 'sampling-plus'`.
    `'commercial'` is the headline "usable in commercial work" control: it does
    NOT enumerate what to exclude — it admits ONLY the commercial-safe licenses,
    which is how CC-BY-NC and legacy Sampling+ are kept out before a result is
    fetched.
  - `SearchPrefs = { sort; filter }` — the persisted active state.
  - `SearchOptions` gains `sort?` + `filter?`.
- **Freesound param translation** (`src/core/gateway/freesoundQuery.ts`, pure,
  verified against the APIv2 text-search docs):
  - `freesoundSortParam`: `relevance → undefined` (Freesound default `score`),
    `duration_asc/desc → same`, `rating → rating_desc`, `downloads →
    downloads_desc`, `created → created_desc`.
  - `freesoundFilterString`: space-separated Solr terms —
    `duration:[lo TO hi]` (uppercase `TO`, `*` for an open end),
    `samplerate:44100`, `bitdepth:24`, `channels:2`, `type:wav`,
    `license:"Attribution Noncommercial"` (multi-word values quoted).
    `commercial` → `license:("Attribution" OR "Creative Commons 0")`.
    Returns `undefined` when nothing is constrained.
  - `HttpFreesoundGateway.search` sets `sort=` / `filter=` on the URL ONLY when
    non-empty, so a plain query's request is byte-for-byte unchanged.
- **Gateway seam**: `GatewaySearchParams` gains `sort?` / `filter?`.
  `FakeFreesoundGateway` records the full params (incl. a copy of the structured
  `filter`) on every `search` call; fixtures are still keyed by `query` alone, so
  tests assert on the *request*.
- **Cache key** (`src/core/db/searchCache.ts` + `src/core/index.ts`):
  `cacheKey(...)` now hashes `{ query, page, pageSize, sort, filter }`. The core
  first *normalizes*: `relevance` and an all-empty filter collapse to `undefined`
  and `canonicalJson` drops them, so an unfiltered query hashes EXACTLY as it did
  pre-ticket — no migration, no collision, and differently-filtered/-sorted
  queries land on independent rows.
- **Prefetch** (`prefetchNextPage`) now takes the normalized `sort` + `filter`
  and threads them into both the next-page cache-key computation and the
  `runSearch` call, so page 2 is fetched *with the same constraints* and cached
  under the filtered next-page key (not the bare one).
- **Persistence**: `core.getSearchPrefs()` / `core.setSearchPrefs(prefs)` store a
  JSON blob in `app_meta` under `search_prefs` (migration 002 table, no new
  migration). `getSearchPrefs` falls back to `{ sort: 'relevance', filter: {} }`
  on absence or a corrupt blob. `setSearchPrefs` never runs a search.
- **preload**: `getSearchPrefs` / `setSearchPrefs` on the `core:invoke`
  passthrough (no `src/main` change); filter/sort/prefs types re-exported.
- **Renderer**:
  - `src/renderer/store/useSearchPrefs.ts` — Zustand mirror of the persisted
    prefs. `load()` on startup; every `setSort` / `setFilter` / `removeFilter` /
    `clearFilter` writes through to `core.setSearchPrefs`. `ready` gates the
    first search so there is no unfiltered flash.
  - `src/renderer/lib/filterLabels.ts` — pure option lists + `activeFilterChips`
    (a `SearchFilter` → removable-chip derivation, reused for the empty-results
    hint).
  - `src/renderer/components/FilterBar.tsx` — the sort `<select>` + duration
    min/max inputs + sample-rate / bit-depth / channels / file-type / license
    dropdowns, then a row of removable active-filter chips and a "Clear all".
  - `src/renderer/hooks/useSearch.ts` — now `useSearch(query, sort, filter,
    ready)`; re-runs page 1 when sort or any filter value changes (keyed on
    `JSON.stringify(filter)`), and `loadMore` carries the current sort/filter via
    a ref. Changing a filter never touches the query text (owned by `App`).
  - `src/renderer/App.tsx` — mounts `<FilterBar/>` under the search box, loads
    prefs once, and when a filtered query returns zero results shows a "try
    relaxing this filter" panel with one button per active filter plus
    "Clear all filters".
- `test/search-filters.test.ts` — 26 tests: `freesoundSortParam` /
  `freesoundFilterString` exact-string translation for every dimension +
  composition + the commercial-license exclusion; `HttpFreesoundGateway` puts
  `sort=`/`filter=` on the URL (and omits them when neutral); the core threads
  every filter dimension + every sort option through to the fake as structured
  params; query + sort + all filters compose in one call; the cache key isolates
  differently-filtered and differently-sorted queries (distinct rows, no gateway
  call on a re-hit, unfiltered row not shadowed); prefetch carries the same
  sort+filter and serves page 2 from cache; prefs round-trip through a fresh core
  on the same DB and `setSearchPrefs` runs no search.

### Deferrals / judgement calls (ticket 15)

- **No new migration.** `app_meta` (m002) already exists; `search_cache.key` is a
  hash of an open-ended params object, so folding in `sort`/`filter` needs no
  schema change. `MIGRATIONS` is still `[m001, m002]`.
- **`license: 'commercial'` is an inclusion list, not an exclusion.** Admitting
  only `"Attribution"` + `"Creative Commons 0"` is robust to Freesound adding
  further non-commercial license strings later; the ADR/CONTEXT § License
  obligation is untouched — this is only a pre-search convenience.
- **Sample rate / bit depth / channels are exact-match dropdowns**, not ranges —
  the ticket asks to "filter by" them, and Freesound indexes them as exact
  integers. Duration is the only range control.
- **"Clear all" clears filters only, not sort** — sort is not a filter, and
  wiping it on a filter-clear is surprising. Sort has its own reset (pick
  "Relevance").
- **Filter change re-runs from page 1.** "Don't lose the user's place" is read as
  "don't clear the query text" (we don't); the result set genuinely changes, so
  resetting to page 1 is correct.
- **Pre-existing `test/eviction.test.ts` flakiness** (ticket 10's file, timing
  based) still surfaces under heavy full-suite CPU contention — it is 25/25 green
  in isolation and 8/8 green across spaced full-suite runs. Hardened one
  assertion (line ~259) to poll for the staging-status transition instead of
  assuming it lands with the file unlinks; the remaining races in that file are
  ticket-10 scope. The 26 new tests add no timers — every assertion is on a
  recorded call param or a DB row.

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
