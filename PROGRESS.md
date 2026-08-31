# Progress

Tracer-bullet backlog: `.scratch/freesound-desktop-v1/`. Ticket 09 (the milestone) is
built and its macOS drag-out was manually verified by the user on 2026-08-30. Tickets 10
(sidecars + LRU eviction), 11 (Library save / view / delete), 15 (search filters +
sort), 12 (computed peaks + canvas waveform) and 13 (library organisation) are
done. Next frontier: 14, 16, 18; then 17 after 16; 19 last.

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
| 15 | Search filters and sort | **done** — code + tests (`test/search-filters.test.ts`) | `eb78025` |
| 12 | Computed peaks + canvas waveform | **done** — code + tests (`test/peaks.test.ts`, `test/waveform-peaks.test.ts`) | `9a9febc` |
| 13 | Library organisation | **done** — code + tests (`test/library-organisation.test.ts`) | `8eea6e1` |
| 14, 16–19 | Sidecar rebuild, collections, manifest, overlays, packaging | not started | — |

## Test counts

- `apps/desktop`: 171 vitest tests (+11 for ticket 13), `tsc --noEmit` clean, `electron-vite build` clean.
- `worker`: 30 vitest tests, `tsc --noEmit` clean.
- `spike/drag-out`: syntax-checked only (throwaway).

## Ticket 13 — what landed

- **Overlay storage — no migration.** `library_entries.custom_name` /
  `custom_tags` were created by **m001** (NULL, explicitly for this ticket).
  `MIGRATIONS` stays `[m001, m002]`. `src/core/db/library.ts` gains:
  - `LibraryOverlay { soundId, customName, customTags, savedAt }` +
    `rowToOverlay` — `custom_tags` is a JSON array serialised exactly like
    `sounds.tags`; a corrupt blob degrades to `[]`, never throws.
  - `getLibraryOverlay` / `listLibraryOverlays(db, dir)` (ordered by
    `saved_at`, mirrors `listLibrarySoundIds`).
  - `setCustomName(db, id, string | null)` — writes ONLY
    `library_entries.custom_name`; the `sounds` row (author, License,
    Freesound name + URL) is never touched, so a rename cannot sever the
    link to the original.
  - `setCustomTags(db, id, tags)` — replaces the list; `[]` stored as NULL.
- **New domain types** (`src/core/types.ts`, exported):
  - `LibrarySound extends Sound` — adds `customName: string | null`,
    `effectiveName` (`customName ?? name` — what a Drag-Out delivers),
    `customTags: string[]`, `savedAt: number`.
  - `LibraryFilter` — all optional: `tags[]`, `license` (reuses
    `LicenseFilter`), `durationMin`/`durationMax`, `fileType`, `text`.
- **Pure filter predicate** (`src/core/library/libraryFilter.ts`, no I/O,
  unit-tested directly):
  - `matchesLibraryFilter(sound, filter)` — dimensions compose with **AND**.
    `tags` matches a Sound carrying **ANY** listed tag, inherited **or**
    custom, case-insensitively. `text` is a case-insensitive substring
    match across custom name + Freesound name + author + every tag.
    `fileType` is a case-insensitive exact match on `sound.type`. Duration
    is an inclusive range.
  - `LICENSE_FILTER_NAMES` maps each `LicenseFilter` to the
    `sounds.license_name` values it admits; `'commercial'` →
    `['CC0', 'CC-BY']` — the same "usable in commercial work" inclusion
    semantics ticket 15 established, applied to the local `license_name`
    labels from `gateway/mapRawSound`.
  - `normaliseTags` (trim / de-dupe case-insensitively / drop empties),
    `hasLibraryFilter`, `normaliseLibraryFilter` (mirrors ticket 15's
    `normalizeFilter` — an all-empty filter round-trips as `{}`).
- **Core command API** (`src/core/index.ts`):
  - `listLibrary(opts?)` now returns `LibrarySound[]` — a new module-level
    `readLibrary(db, dir, filter?)` reads `listLibraryOverlays` +
    `getSoundsByIds` and merges them (a lost `sounds` row is skipped, not
    thrown). Still **zero gateway calls**.
  - `filterLibrary(filter, opts?)` — `readLibrary` with the predicate
    applied in-process. The Library is a small per-device table, so a
    linear pass after one indexed read is instant; **no network request,
    ever** (a test asserts `gateway.searchCallCount === 0` across every
    dimension).
  - `setCustomName(id, name | null)` / `setLibraryTags(id, tags)` — both
    guard with `hasLibraryEntry` and **throw** for a Sound not in the
    Library; `setCustomName` trims and treats `''` as "clear".
  - `getLibraryFilter()` / `setLibraryFilter(filter)` — JSON blob in
    `app_meta` under `library_filter`, exactly the ticket-15
    `getSearchPrefs`/`setSearchPrefs` pattern. `setLibraryFilter` runs no
    query.
- **Drag-out routes the custom name** (`src/core/staging/dragController.ts`):
  `startDrag` now computes `effectiveDragName(sound)` — the custom Library
  name when set (non-blank), else `sound.name` — and feeds it through the
  **unchanged** `sanitiseStem` (illegal-char stripping) + ` (2)`/` (3)`
  collision disambiguation from ticket 09. A custom name with unsafe
  characters is sanitised identically; re-dragging the same renamed
  Original still reuses its one hardlink.
- **preload**: `filterLibrary` / `setCustomName` / `setLibraryTags` /
  `getLibraryFilter` / `setLibraryFilter` on the `core:invoke` passthrough
  (no `src/main` change); `LibrarySound` / `LibraryFilter` re-exported;
  `listLibrary` return type widened to `LibrarySound[]`.
- **Renderer**:
  - `src/renderer/store/useLibraryFilter.ts` — Zustand mirror of the
    persisted Library filter (same shape as `useSearchPrefs`): `load()` on
    startup, every mutation writes through to `core.setLibraryFilter`.
    `addTag` / `removeTag` / `setFilter` / `removeFilter` / `clearFilter`,
    plus `pruneLibraryFilter` / `hasLibraryFilter` helpers.
  - `src/renderer/components/LibraryFilterBar.tsx` — free-text box, a
    tag-add input (Enter / comma / blur commits), duration min/max, file
    type + license `<select>`s (reusing `filterLabels` option lists), then
    a row of removable chips (one per tag, plus text / duration / type /
    license) and a "Clear all". Mounted under the Library header in
    `App.tsx`.
  - `src/renderer/hooks/useLibraryView.ts` — takes the filter, calls
    `window.core.filterLibrary(filter, { sort: 'savedAt', dir })`,
    re-fetches on tab-activate, sort-dir change, `useLibrary.revision`
    (save/remove/**rename/retag**) and a real filter change
    (`JSON.stringify` key). Returns `LibrarySound[]`.
  - `src/renderer/store/useLibrary.ts` — `rename(id, name | null)` /
    `setTags(id, tags)` actions that call the core then bump `revision`.
  - `src/renderer/components/ResultRow.tsx` — the `variant="library"` row
    shows `effectiveName` (with an "aka <Freesound name>" hint when
    renamed), a **Rename** button (`window.prompt`, blank = revert to the
    Freesound name — matching the ticket-11 `window.confirm` precedent),
    the user's own tags as removable **emerald** chips visually distinct
    from the inherited Freesound tags (muted grey text), and a `+ tag`
    button. Search rows are unchanged.
  - `src/renderer/App.tsx` — loads the Library filter once on mount, mounts
    `<LibraryFilterBar/>`, and shows a "No Library sounds match this
    filter" panel with a Clear-all button, distinct from the empty-Library
    message.
- **Tests** (`test/library-organisation.test.ts`, 11): a custom name flows
  through to the exact path handed to `DragHost` (basename = sanitised
  custom name, still the Original's bytes); clearing it falls back to the
  Freesound name; unsafe characters in a custom name are sanitised and the
  ` (2)` scheme stays reserved for real collisions (idempotent re-drag);
  renaming + retagging leaves `sounds` (author / License / URL / Freesound
  name) untouched while `customName` / `customTags` take effect; inherited
  and own tags coexist; `setCustomName` / `setLibraryTags` throw off-Library;
  custom name + tags survive a `createCore` restart; `filterLibrary` returns
  the right rows for file format, License (incl. `commercial` = CC0+CC-BY),
  duration range, tag (inherited + custom, ANY-of), free text (custom name /
  Freesound name / author / tag) and every combination — with
  `gateway.searchCallCount === 0` throughout; the persisted filter
  round-trips through a fresh core; `setLibraryFilter` runs no search; the
  pure `matchesLibraryFilter` predicate.

### Deferrals / judgement calls (ticket 13)

- **No migration.** `library_entries.custom_name` / `custom_tags` exist
  from m001 (NULL until now, by design). `app_meta` (m002) already backs
  the `library_filter` blob. `MIGRATIONS` stays `[m001, m002]`.
- **`filterLibrary` filters in-process after one full-table read, not in
  SQL.** The tag / free-text dimensions span a JSON column and a
  `library_entries`↔`sounds` join; a JS predicate over the Library (a
  small, per-device table) is simpler, has less bug surface, and is still
  "served from the database with no network request and feels instant" —
  which is what the ticket asks. If a Library ever grows to many thousands
  of rows, push the cheap dimensions (duration / type / license via
  `license_name`) into a `WHERE` and keep the predicate for tags + text.
- **License filter matches the local `license_name` label**
  (`'CC0'` / `'CC-BY'` / …) from `gateway/mapRawSound`, not the Freesound
  Solr license string used by the ticket-15 *search* filter. Same
  `LicenseFilter` type and the same `'commercial'` = CC0 + CC-BY
  inclusion; the two just resolve against different stored representations.
- **Rename / add-tag use `window.prompt`.** Consistent with ticket 11's
  `window.confirm` for delete ("enough for v1"); an inline editor is a
  clean follow-up and needs no core change.
- **`setLibraryTags` replaces the whole custom-tag list** (the core
  primitive); the renderer computes add/remove against the current list.
  Keeps the command surface minimal and the DB write a single UPDATE.
- **No renderer component tests** (spec 0001: none exist). The filter bar,
  the rename prompt and the chip styling need the Electron GUI — see
  "Needs manual verification".
- **`test/eviction.test.ts` pre-existing flake** (ticket 10, timing-based)
  still trips occasionally under full-suite CPU contention — green in
  isolation (5/5) and across repeated full runs (3/3 after the new file
  landed). The 11 new tests add no timers that race: the only `sleep`s
  just space out `saved_at` for a deterministic sort order.

### Needs manual verification (ticket 13)

- In the GUI: rename a Library Sound, drag it into a DAW, confirm the
  region arrives under the custom name; clear the name and confirm it
  reverts to the Freesound name on the next drag.
- Add / remove your own tags on a Library row and confirm they read
  distinctly from the inherited Freesound tags.
- Exercise every Library filter control (tag, license, duration, file
  type, free text) and combinations; confirm results update instantly with
  no network activity, the active-filter chips are visible, and "Clear
  all" empties them.

## Ticket 12 — what landed

- **Decoder** (`src/core/peaks/decodeAudio.ts`, pure byte parsing, no DOM /
  Electron / native addon): `decodeAudioBuffer(bytes)` → `{ sampleRate,
  length, channelData: Float32Array[] }` for **WAV** (RIFF/RIFX, PCM +
  IEEE-float, 8/16/24/32-bit, `WAVE_FORMAT_EXTENSIBLE`) and **AIFF/AIFC**
  (big-endian PCM, 80-bit extended sample rate). Anything else — mp3, flac,
  ogg, a truncated/corrupt file — throws `UndecodableAudioError`.
- **Envelope** (`src/core/peaks/computePeaks.ts`): `computePeaks(decoded,
  targetBuckets = 2000)` → `ComputedPeaks { sampleRate, bucketCount, data:
  Int16Array }`, interleaved `[min,max]` per bucket, peaks taken across **all
  channels together** (mono summary — a transient in either channel shows).
  `BASE_BUCKET_COUNT = 2000`.
- **File → envelope** (`src/core/peaks/computeFromFile.ts`):
  `computePeaksFromFile(path, buckets)` → discriminated `PeakResult`
  (`{ ok:true, value }` | `{ ok:false, undecodable, error }`) — never throws
  for undecodable audio; a missing/unreadable file is `undecodable:false`
  (transient, not cached).
- **Worker** (`src/core/peaks/peakWorker.ts`): a **separate electron.vite
  `main` build entry** → `out/main/peakWorker.js`. `node:worker_threads`
  entry: `workerData { filePath, targetBuckets }` in, one
  `PeakWorkerResponse` out (Int16 buffer transferred). One Worker spawned
  per computation, exits after its single message. Not loaded under Vitest.
- **Service** (`src/core/peaks/peakService.ts`): `createPeakService({ db,
  dataDir, peakWorkerPath?, runner?, onStatusChange? })`.
  - `getPeaks(id)` — reads the `peaks` BLOB (Int16LE via `Buffer.readInt16LE`
    — no alignment assumptions), returns `PeaksPayload { sampleRate,
    bucketCount, peaks: number[] }` (floats in [-1,1]) or `null`
    (`bucket_count = 0` sentinel, or no row). **Cache only — never computes.**
  - `requestPeaks(id)` — returns synchronously. Cache hit → announce
    `ready`/`unavailable` at once. Miss + Original on disk → run
    `runner(path, 2000)` **off this thread**, cache the result, announce.
    Deduped per Sound (`inFlight` map). **No off-thread path configured
    (no `runner`, no `peakWorkerPath`) → it will NOT fall back to blocking
    work; it announces `unavailable`.**
  - Undecodable → writes a **sentinel** row (`sample_rate 0, bucket_count 0,
    empty BLOB`) so the mp3/flac/ogg (or corrupt file) is never re-decoded;
    `getPeaks` still returns `null` so the renderer keeps the image.
  - `workerRunner(path)` is the production `PeakRunner` (real Worker);
    exported from the core as `createPeakWorkerRunner`.
- **`peaks` table**: created empty by **m001** already — **no migration**,
  `MIGRATIONS` stays `[m001, m002]`. `src/core/db/peaks.ts` —
  `getPeaksRecord` / `hasPeaksRecord` / `putPeaksRecord` (INSERT … ON
  CONFLICT) / `deletePeaksRecord`.
- **Auto-compute on download**: `stagingController` gains an optional
  `onOriginalReady(soundId)` dep, fired in `onComplete` right after the
  Original + `staged_entries` row land (wrapped, best-effort). The core
  wires it to `peakService.requestPeaks`, so peaks are computed the moment
  the audio is on disk, not only when the user first looks.
- **Deletion / eviction**: `deletePeaksRecord` is called from
  `core.deleteFromLibrary` (next to the Original + sidecar unlink) and from
  `eviction.ts` `removeStaged` (so `evictStagedOverBudget` and `clearStaged`
  both clear peaks). Cached peaks never outlive the Original.
- **Core API** (`src/core/index.ts`): `getPeaks(id): PeaksPayload | null`,
  `requestPeaks(id): void`, `subscribePeaksStatus(listener)`. New
  `CoreDeps`: `peakWorkerPath?`, `computePeaksRunner?`,
  `onPeaksStatusChange?`. `close()` also closes the peak service.
- **main** (`src/main/index.ts`): passes `peakWorkerPath: join(__dirname,
  'peakWorker.js')` and `onPeaksStatusChange: broadcastPeaksStatus` (new
  `core:event:peaksStatus` channel, same pattern as staging).
- **preload**: `getPeaks` / `requestPeaks` on the `core:invoke` passthrough;
  `onPeaks(listener)` on the `core:event:peaksStatus` channel; `PeaksPayload`
  / `PeaksStatusChange` re-exported.
- **Renderer**:
  - `src/renderer/lib/waveformPeaks.ts` (pure, tested): `resamplePeaks(env,
    columns, start, end)` — resamples the fixed base envelope to any pixel
    width **and any zoom window** (sub-range of 0..1), one min/max pair per
    column, extreme over every base bucket a column spans (blocky when
    over-zoomed, never gappy). `drawPeakWaveform(canvas, env, opts)` — sizes
    the backing store to `width*dpr × height*dpr` (sharp at any width / HiDPI).
    `pointerToFraction(xFrac, z0, z1)` — maps a pointer into the whole-file
    fraction through the zoom window (seek stays accurate while zoomed).
    `zoomWindow(z0, z1, factor, focus, minSpan)` — zoom step pinned to a
    focus point, clamped to [0,1] and a 0.02 min span.
  - `src/renderer/store/usePeaks.ts` — Zustand mirror. `ensure(id)` asks
    `core.getPeaks` then `core.requestPeaks`; one module-level
    `core.onPeaks` subscription folds results in. Values: `undefined`
    (pending) / `null` (none — keep the image) / `PeaksPayload`. A payload
    is **never** downgraded back to null/undefined — a Sound upgrades from
    image to canvas once and never flickers back.
  - `src/renderer/components/Waveform.tsx` — two paths, **same box, same
    playhead node, no layout shift**: no peaks → the ticket-03 Freesound-PNG
    mask (IntersectionObserver gating unchanged); peaks → a `<canvas>` drawn
    from the envelope, redrawn on `ResizeObserver` + zoom change. Wheel =
    zoom toward the cursor; double-click / a `1:1` button = reset; pointer
    down+drag = scrub (through `pointerToFraction`). Writes `--pz0` /
    `--pspan` onto the playhead node.
  - `src/renderer/index.css` — `.waveform-playhead` `left` now maps the
    whole-file `--playhead` into the `--pz0` / `--pspan` window and clamps
    to the box edges.
  - `src/renderer/store/audioController.ts` — the single playhead node
    became a `Map<HTMLElement, soundId>` so the result-row waveform **and**
    the transport-bar waveform for the same Sound both animate; the rAF
    loop / `seekFraction` / `resetPlayhead` write every node whose id is the
    one playing. `unregisterPlayheadNode` takes a node or (back-compat) a
    sound id.
  - `src/renderer/store/useTransport.ts` — adds `currentSound: Sound | null`
    (coarse, flips only on a track change) so the transport bar can mount a
    full waveform.
  - `src/renderer/components/TransportBar.tsx` — a full-width `h-16`
    `<Waveform active>` for `currentSound` above the controls: the zoom /
    scrub / inspect surface for a long recording.
- **Tests**: `test/peaks.test.ts` (10) — WAV + AIFF decode and a correct
  min/max envelope; a **real `node:worker_threads` Worker** runs the compute
  off-thread (`threadId >= 1`) and returns the envelope; peaks computed
  **once** on stage and a fresh core on the same DB serves them from cache
  with a runner that throws if called; `requestPeaks` **returns
  synchronously** and `search` / `getStagingStatus` / `getDragCapabilities`
  all still answer while a computation is parked in a held-open runner;
  undecodable bytes → sentinel row, `getPeaks` → `null` (no throw), not
  retried; `deleteFromLibrary` **and** `evictStagedOverBudget` drop the
  `peaks` row with the Original; a search result with no Original has
  `getPeaks` → `null` and `requestPeaks` → `unavailable`.
  `test/waveform-peaks.test.ts` (11) — `resamplePeaks` column count at any
  width, aggregation, zoom-window slicing, over-zoom stability;
  `pointerToFraction` 1:1 and zoomed + clamping; `zoomWindow` focus, clamp,
  min-span, edge-pin.

### Deferrals / judgement calls (ticket 12)

- **No migration.** The `peaks` table (`sound_id, sample_rate,
  bucket_count, data, computed_at`) was created empty by m001 for exactly
  this ticket. `MIGRATIONS` stays `[m001, m002]`.
- **Only WAV + AIFF are decoded locally; mp3 / flac / ogg fall back to the
  Freesound waveform image.** The ticket's headline case — a long
  *uncompressed* field recording whose fixed-resolution image is too coarse
  — is covered, and "audio that cannot be decoded falls back to its
  waveform image (no error, no blank)" is an explicit acceptance criterion
  that the sentinel-row path satisfies for every other format. Adding a
  wasm decoder (`audio-decode` or similar) behind the existing
  `decodeAudioBuffer` seam is a clean follow-up: `computeFromFile` /
  `peakWorker` / the whole cache + eviction machinery need no change, and
  the Worker build entry is already wired. Not done now to avoid shipping a
  fragile wasm dependency + its packaging story (ticket 19) under this
  ticket.
- **Peak service will not compute without an off-thread path.** With no
  `peakWorkerPath` and no injected `runner` (i.e. a bare test core),
  `requestPeaks` announces `unavailable` rather than decoding inline. This
  keeps "never on the main/renderer thread" a structural guarantee, not a
  convention, and keeps every pre-ticket test's timing untouched.
- **Playhead accuracy is against the Preview being auditioned.** The
  `<canvas>` is drawn from the Original's peaks, but playback is still the
  Preview mp3 (ADR-0003 — the Original is never streamed). `--playhead` is
  `audio.currentTime / audio.duration` at full media-element precision;
  Preview and Original share a timeline, so the playhead is sample-accurate
  against *what is playing*. A dedicated Original-playback path is out of
  scope.
- **Zoom detail is bounded by the 2000-bucket base envelope.** Zooming past
  ~1.3× shows the base grid getting blocky rather than revealing new
  sample detail — the honest limit of a single cached resolution. A
  multi-resolution / re-decode-on-deep-zoom scheme was judged more than v1
  needs.
- **No renderer component tests** (spec 0001: none exist). The canvas draw
  path, `ResizeObserver`/`devicePixelRatio` sharpness, and the wheel-zoom /
  drag-scrub *feel* need the Electron GUI — see "Needs manual verification".
- **`test/eviction.test.ts` pre-existing flake** (ticket 10, timing-based)
  is unchanged: green in isolation and across spaced full-suite runs, can
  trip under heavy parallel-file CPU contention. The 21 new tests add no
  such races (injected runners / held-open promises / direct calls).

### Needs manual verification (ticket 12)

- Real audio: point the app at an actual downloaded WAV/AIFF Original and
  confirm the canvas waveform matches the sound, is crisp on a HiDPI
  display and at every window width, and that an mp3/flac/ogg Original
  cleanly keeps the Freesound image with no console error.
- GUI feel: wheel-zoom into a long recording, double-click / `1:1` to
  reset, click and drag to scrub while zoomed, and confirm the playhead
  stays glued to the audio position (and parks at the edge when the
  play position is outside the zoom window).
- Confirm `out/main/peakWorker.js` actually spawns in a packaged-style run
  (it builds; not yet exercised end-to-end in Electron).

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
