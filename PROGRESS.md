# Progress

Tracer-bullet backlog: `.scratch/freesound-desktop-v1/`. Ticket 09 (the milestone) is
built and its macOS drag-out was manually verified by the user on 2026-08-30. Tickets 10
(sidecars + LRU eviction), 11 (Library save / view / delete), 15 (search filters +
sort), 12 (computed peaks + canvas waveform), 13 (library organisation), 14
(rebuild from sidecars), 16 (Collections) and 17 (Attribution Manifest) are done.
Next frontier: 18; 19 last.

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
| 14 | Rebuild from sidecars | **done** — code + tests (`test/rebuild.test.ts`) | `261b47d` |
| 16 | Collections | **done** — code + tests (`test/collections.test.ts`) | `6dfad08` |
| 17 | Attribution Manifest | **done** — code + tests (`test/manifest.test.ts`) | _pending_ |
| 18–19 | Shell polish, packaging | not started | — |

## Test counts

- `apps/desktop`: 212 vitest tests (+11 for ticket 17), `tsc --noEmit` clean, `electron-vite build` clean.
- `worker`: 30 vitest tests, `tsc --noEmit` clean.
- `spike/drag-out`: syntax-checked only (throwaway).

## Ticket 17 — what landed

- **No migration, no new table.** A Manifest is a snapshot *value*, not stored
  state — `core.generateManifest(collectionId)` reads current membership once and
  returns it. Editing the Collection afterwards cannot change a value already
  handed out (a test mutates the Collection every way and asserts the held value
  is byte-identical).
- **`src/core/manifest/obligations.ts`** — two pure predicates over the short
  license label: `requiresAttribution` (everything except `CC0`; unrecognised →
  true) and `restrictsCommercialUse` (the `NC` family; unrecognised → true). The
  renderer's `LicenseChip` keeps its own `name.includes('NC')` check — they must
  stay in step.
- **`src/core/manifest/buildManifest.ts`** — pure, no I/O. `buildManifest({
  collectionId, collectionName, generatedAt, sounds })` → `Manifest { entries,
  summary, text }`. `entries` carries every member with title (the Freesound
  published name, not the user's custom name — attribution names the work),
  author, `licenseName` + `licenseUrl`, `freesoundUrl`, and the two obligation
  booleans. `summary` pre-counts total / attributionRequired / noAttribution /
  nonCommercial. `text` is the pasteable plain-text document: NON-COMMERCIAL
  section first (own list, prominent), then ATTRIBUTION REQUIRED (NC members
  repeated here with an inline `[NON-COMMERCIAL]` marker), then NO ATTRIBUTION
  REQUIRED (CC0). Empty Collection → a clear message, never a blank document.
  `generatedAt` is rendered as a locale-independent `YYYY-MM-DD` so the snapshot
  is byte-stable.
- **Core command API** (`src/core/index.ts`): `generateManifest(collectionId)` —
  looks up the name (`getCollectionName`, new in `db/collections.ts`; throws on
  unknown id), reads members with the same DB-only `readCollectionSounds` the
  Collection view uses (no gateway call), passes `Date.now()`. `Manifest` /
  `ManifestEntry` / `ManifestSummary` and the two predicates are exported.
- **preload**: `generateManifest` on the `core:invoke` passthrough; plus a
  **named channel** `core:saveManifest(defaultFileName, text)` → `{ saved,
  path? }` for the file save (needs Electron `dialog` + `fs` — cannot live in
  core). `Manifest` types re-exported.
- **`src/main/index.ts`** — the `core:saveManifest` handler: native
  `dialog.showSaveDialog` (`.txt` filter) then `fs/promises.writeFile`. Returns
  `{ saved: false }` on cancel.
- **Renderer**:
  - `src/renderer/components/ManifestPanel.tsx` — modal opened from the open
    Collection's header ("Generate manifest"). Fetches a fresh snapshot on
    mount, shows `manifest.text` read-only in a `<pre>`, an amber banner when
    `summary.nonCommercial > 0`, and Copy (`navigator.clipboard.writeText`) /
    "Save to file…" (`core.saveManifest`) actions with a transient status line.
    Esc / backdrop / Close dismiss.
  - `src/renderer/App.tsx` — `showManifest` state, the header button, panel
    render inside a now-`relative` `<section>`; reset on tab switch and on
    leaving the Collection.
  - `src/renderer/components/ResultRow.tsx` — a bold amber **⚠ Non-commercial**
    badge next to the `LicenseChip` on every row (search / Library / Collection),
    so the warning is unmistakable everywhere a Sound appears, not only in the
    Manifest. (License itself was already shown on every surface via
    `LicenseChip`.)
- **`test/manifest.test.ts`** — 11 tests: the `obligations` predicates; the pure
  `buildManifest` text/grouping/empty-collection cases; and the core seam
  (`generateManifest` lists every member with author/License/URL with no gateway
  call, throws on unknown id, is a proven snapshot, separates CC0, flags NC).

## Ticket 16 — what landed

- **No migration.** `collections (id, name, created_at)` and
  `collection_members (collection_id, sound_id, added_at, PRIMARY KEY(collection_id,
  sound_id))` were created empty by **m001** (with `FOREIGN KEY(sound_id)
  REFERENCES sounds(id) ON DELETE CASCADE` and the same on `collection_id`).
  `MIGRATIONS` stays `[m001, m002]`; `db/index.ts` already runs
  `PRAGMA foreign_keys = ON`.
- **`src/core/db/collections.ts`** — the DB access seam (no Electron, unit-tested
  through the core):
  - `insertCollection` / `updateCollectionName` / `deleteCollectionRow` /
    `hasCollection`.
  - `addMembers(db, collectionId, soundIds, now)` — one transaction,
    `INSERT … ON CONFLICT(collection_id, sound_id) DO NOTHING`, so a batch add of
    a mixed selection is idempotent and never moves an existing `added_at`.
  - `removeMember` — deletes only the one join row.
  - `clearSoundFromAllCollections(db, soundId)` — `DELETE FROM
    collection_members WHERE sound_id = ?`, called explicitly from
    `deleteFromLibrary` (which KEEPS the `sounds` row, so the FK cascade does not
    fire).
  - `listCollectionSummaries` → `{ id, name, count }[]` ordered by
    `name COLLATE NOCASE`, then id (count via a correlated sub-select).
  - `listCollectionMemberIds(db, collectionId, dir)` — member ids, most-recently
    added first (`dir` flips it), `JOIN library_entries` so a Sound that somehow
    left the Library cannot appear.
  - `collectionsForSounds(db, soundIds)` → `{ [soundId]: {id,name}[] }` for the
    per-row badges; every requested id present (mapped to `[]`).
- **New domain types** (`src/core/types.ts`, exported): `CollectionSummary
  { id, name, count }`, `CollectionRef { id, name }`.
- **Core command API** (`src/core/index.ts`):
  - `createCollection(name)` → `CollectionSummary` (trims; empty name throws).
  - `renameCollection(id, name)` (trims; empty throws; no-op on unknown id).
  - `deleteCollection(id)` — drops the `collections` row + its
    `collection_members` (FK cascade); `library_entries` and files are never
    touched. Confirmation is a `window.confirm` in the renderer.
  - `addToCollection(collectionId, soundIds[])` — batch, idempotent. Throws if
    the Collection is unknown, or if any Sound is not in the Library (a
    Collection is a set of *Library* Sounds — a Staged Sound cannot belong to
    one).
  - `removeFromCollection(collectionId, soundId)` — leaves the Sound in the
    Library and in every other Collection.
  - `listCollections()` → `CollectionSummary[]`.
  - `listCollectionSounds(collectionId, { dir? })` → `LibrarySound[]` — the SAME
    hydrated shape `listLibrary` returns (Sound + `customName` / `effectiveName`
    / `customTags` / `savedAt`), so a Collection browses, plays, drags and
    renames identically to the Library. Served ENTIRELY from SQLite — a test
    asserts no gateway `search` call.
  - `getCollectionsForSounds(soundIds[])` → `Record<number, CollectionRef[]>`.
  - `saveToLibrary(soundId, sound?, collectionIds?)` — the optional third arg
    files the Sound into those Collections in the SAME transaction as the save
    (each id validated first — an unknown Collection throws before anything is
    written), so filing at save time is one action.
  - `deleteFromLibrary` now wraps `deleteLibraryEntry` +
    `clearSoundFromAllCollections` + `deletePeaksRecord` in one transaction
    before unlinking the files — a Sound leaving the Library leaves every
    Collection with it.
- **preload**: `createCollection` / `renameCollection` / `deleteCollection` /
  `addToCollection` / `removeFromCollection` / `listCollections` /
  `listCollectionSounds` / `getCollectionsForSounds` on the `core:invoke`
  passthrough (no `src/main` change); `saveToLibrary` signature widened with
  `collectionIds?`; `CollectionSummary` / `CollectionRef` re-exported.
- **Renderer**:
  - `src/renderer/store/useCollections.ts` — Zustand mirror: `collections`
    list, a per-Sound `memberships` cache (`ensureMemberships` batch-fills gaps
    via `getCollectionsForSounds`, mirroring `useLibrary.ensure`), `revision`
    bump on every mutation, and `create` / `rename` / `remove` / `addSounds` /
    `removeSound` actions that re-`load()` and refresh affected memberships.
  - `src/renderer/store/useMultiSelect.ts` — a tiny `Set<number>` checkbox
    selection for the Library / Collection lists (`toggle` / `set` / `clear`),
    whose only job is to gather Sounds for a one-action batch add.
  - `src/renderer/components/CollectionMenu.tsx` — a dropdown that lists
    Collections and creates one inline (Enter / Add), calling back with the
    chosen (or freshly created) id. Closes on outside-click / Escape.
  - `src/renderer/components/CollectionsPanel.tsx` — the flat browse list: a
    "New collection" field, and per row name + count, **Rename**
    (`window.prompt`), **Delete** (`window.confirm`, matching ticket 11), and
    click-to-open. No tree, no nesting affordance.
  - `src/renderer/components/AddToCollectionBar.tsx` — appears while ≥1 row is
    checked; "Add to collection ▾" (a `CollectionMenu`) files every checked
    Sound in one `addToCollection` call, then clears the selection.
  - `src/renderer/hooks/useCollectionView.ts` — loads one Collection's
    `listCollectionSounds`; re-fetches on open-collection / sort-dir change and
    on `useCollections.revision` / `useLibrary.revision`. No gateway, no paging.
  - `src/renderer/components/ResultRow.tsx` — `variant` gains `'collection'`;
    `isLibraryVariant = variant !== 'search'` now drives the rename / tags /
    actions block, plus a new leading **checkbox** and **Collection-membership
    badges** (sky chips). The remove button takes optional `removeLabel` /
    `removeTitle` (Collection view: "Remove from collection"). Search rows gain
    a **"＋ list"** `CollectionMenu` that calls `saveToLibrary(id, sound,
    [collectionId])` — save-and-file in one gesture.
  - `src/renderer/components/ResultList.tsx` — passes `removeLabel` /
    `removeTitle` through; Delete/Backspace now fires `onRemove` for any
    non-search variant.
  - `src/renderer/App.tsx` — third **Collections** tab. With no Collection open
    it shows `<CollectionsPanel>`; opening one shows a "‹ All collections" back
    button + name + an added-order sort toggle and browses the members in the
    same virtualized `ResultList` (`variant="collection"`, remove = remove from
    the Collection, no file deletion, no confirm). `<AddToCollectionBar>` is
    mounted above both the Library and Collection lists. Switching tab / going
    back clears the row selection and the checkbox selection. A header line
    states "Collections do not nest."
- **Tests** (`test/collections.test.ts`, 16): create (trimmed) + reject empty
  name; rename without touching members; a Sound in two Collections at once,
  with correct `getCollectionsForSounds` badges; add is idempotent (no dup row,
  `added_at` unmoved); batch-add a mixed selection in one call; `addToCollection`
  throws for a non-Library Sound and for an unknown Collection; remove from a
  Collection preserves Library membership AND the other Collection; remove is a
  no-op when absent; delete a Collection leaves every Sound in the Library and
  the files on disk, and drops the `collection_members` rows; delete a Sound
  from the Library clears every membership while other Sounds' memberships stay
  intact; `saveToLibrary(id, sound, [ids])` saves and files in one action, and
  throws (saving nothing) for an unknown Collection; `listCollectionSounds`
  makes no gateway call and carries the user's `customName` / `customTags`
  overlay; membership persists across a `createCore` restart.

### Deferrals / judgement calls (ticket 16)

- **No migration.** Both tables were pre-created empty by m001 for this ticket;
  the guidance's "if so, use it" path. `MIGRATIONS` stays `[m001, m002]`.
- **Collection deletion cascades its members via the FK**, not an explicit
  `DELETE`. Foreign keys are on (`db/index.ts`), the m001 constraint is
  `ON DELETE CASCADE`, and a test asserts the join rows are gone. The Library
  delete path is the one that needs the explicit
  `clearSoundFromAllCollections`, because it deliberately keeps the `sounds`
  row.
- **`addToCollection` throws for a non-Library Sound** (rather than silently
  filtering) — mirrors `setCustomName` / `setLibraryTags`, and a Collection is
  defined as a set of *Library* Sounds (CONTEXT.md § Staged: a Staged Sound
  "cannot belong to a Collection"). The renderer only ever offers the checkbox
  on already-saved rows, so this is a guard, not a normal path.
- **Members are ordered most-recently-added first.** A Collection is an
  *unordered* set, so any stable order is valid; "what did I just file" is the
  useful default, and the header toggle flips it. There is no manual reordering.
- **Multi-select is checkboxes, not shift/ctrl-click.** Robust, obvious, and
  the batch-add target is met. Row keyboard nav (ticket 03/04) is untouched.
- **Save-and-file on a search row uses the "＋ list" menu**; the bare `s`
  keystroke still does a plain save. Adding a keyboard variant for
  save-into-collection was judged more surface than v1 needs.
- **No renderer component tests** (spec 0001: none exist). `CollectionsPanel`,
  `CollectionMenu`, `AddToCollectionBar`, the checkbox and the badges are
  straight presentation over the core commands and the two stores, all covered
  at the core seam — see "Needs manual verification".
- **`test/eviction.test.ts` pre-existing flake** (ticket 10, timing-based) is
  unchanged — it was green on the full run after this ticket landed; the 16 new
  tests add no timers (every assertion is on a DB row or a returned value).

### Needs manual verification (ticket 16)

- In the GUI: create a Collection; from search, use "＋ list" to save a Sound
  straight into it; from the Library, tick several rows and "Add to collection";
  confirm each row shows the right Collection badges.
- Open a Collection and confirm playback, waveform and drag-out behave exactly
  as in the Library, and that "Remove from collection" leaves the Sound in the
  Library (and in any other Collection).
- Rename a Collection; delete one and confirm the `window.confirm` copy and that
  its Sounds remain in the Library.
- Delete a Sound from the Library and confirm it vanishes from every Collection.

## Ticket 14 — what landed

- **The sidecar was already sufficient — not widened.** `Sidecar` (ticket 10,
  `src/core/staging/contentStore.ts`) carries `soundId`, `freesoundUrl`,
  `downloadedAt`, `author.username`, `license {url,name}`, `file {name,ext,byteSize}`
  and the full `Sound` verbatim. Rebuild reads it as-is; nothing was added, and
  `SIDECAR_SCHEMA_VERSION` stays `1`. A sidecar from a newer app version is still
  accepted as long as the essential fields are present.
- **Read-only scan** (`src/core/rebuild/scanSidecars.ts`, no DB, deletes nothing,
  unit-tested directly):
  - `scanSidecars(contentDir, onProgress?)` — lists the flat content store,
    ignores `*.part` temp files, pairs each `<id>.<ext>` Original with its
    `<id>.json` by the leading integer, and returns
    `{ recovered, orphanAudio, orphanSidecars, malformed, total }`.
  - `validateSidecar` asserts the shape rebuild depends on: a non-object, a
    missing `soundId`, a missing `sound` block, or a missing `sound.username` /
    `sound.license` is thrown as a per-file `Error` and collected into
    `malformed` — it never aborts the run.
  - An Original whose sidecar merely failed to parse is **not** also counted as
    orphan audio (the malformed sidecar already reports it).
  - `onProgress({done,total})` fires once before the first sidecar and once after
    each — a progress bar for large libraries.
  - A missing content dir yields an all-empty scan (a fresh install).
- **Apply + report** (`src/core/rebuild/rebuildService.ts`):
  - `createRebuildService({ db, dataDir, rebuildWorkerPath?, runner?, onProgress? })`.
    The scan runs through an **injectable** `RebuildRunner`: a `worker_threads`
    Worker in production (`rebuildWorkerRunner(path)`), the in-process
    `scanSidecars` when no worker path is set, or a test-supplied runner (which
    wins) — including a controllable promise to prove non-blocking.
  - `rebuildFromSidecars()` applies the scan in **one transaction** —
    `upsertSound(db, sidecar.sound)` then `saveLibraryEntry(db, soundId,
    sidecar.downloadedAt)`. `saveLibraryEntry` is `INSERT … ON CONFLICT DO
    NOTHING`, so a re-run never moves an existing `saved_at`
    (`counts.alreadyPresent` records the overlap).
  - Orphan sidecars (`.json` with no Original) are reported **and** their file
    removed (`cleanedUpSidecars`). Orphan audio (Original with no sidecar) is
    reported and **left on disk** — never imported without attribution, never
    deleted.
  - `RebuildReport = { recovered[{soundId,name,author,license,audioFile}],
    orphanAudio[], orphanSidecars[], malformed[{file,error}], cleanedUpSidecars[],
    notRecoverable, counts }`.
  - `NOT_RECOVERABLE_MESSAGE` — the one honest sentence ("Custom names, custom
    tags and Collections are stored only in the database and cannot be recovered
    by a rebuild."), carried on both the startup assessment (shown in the offer,
    **before**) and the report (shown in the result, **after**).
- **Off the main thread** (`src/core/rebuild/rebuildWorker.ts` +
  `electron.vite.config.ts`): a third `main` build entry lands at
  `out/main/rebuildWorker.js` (reusing the ticket-12 `peakWorker` wiring); it runs
  `scanSidecars` and posts `progress` / `done` / `error`. `src/main` passes
  `rebuildWorkerPath: join(__dirname, 'rebuildWorker.js')`.
- **Startup detection** (`src/core/db/index.ts` + `src/core/startup/assessStartup.ts`):
  - `inspectDbHealth(dbPath): DbHealth` — a read-only open plus
    `PRAGMA quick_check` and a check for the `sounds` + `library_entries` tables,
    **without** migrating or creating anything. Returns
    `{ ok: true }` or `{ ok: false, reason: 'missing' | 'unreadable' |
    'schema-incomplete' }`.
  - `assessStartup({ dbPath, dataDir })` → `{ db, sidecarCount, offerRebuild,
    notRecoverable }`. `offerRebuild` is true only when the DB is **unusable AND**
    at least one sidecar exists — a missing DB with an empty content store is
    just a first run.
  - `createCore` calls `assessStartup` **before** `openDb` (which would recreate
    a blank schema and hide the condition) and exposes it as
    `core.getStartupAssessment()`.
- **core command API**: `getStartupAssessment()`, `rebuildFromSidecars()`,
  `subscribeRebuildProgress(listener)`. `CoreDeps` gains `rebuildWorkerPath?`,
  `rebuildRunner?`, `onRebuildProgress?`.
- **src/main/index.ts** (thin): `assessStartup` on launch; if the DB file is
  `unreadable` it is renamed to `library.db.corrupt-<ts>` so `openDb` can start a
  fresh schema for the rebuild to fill; `onRebuildProgress` →
  `core:event:rebuildProgress`; on `did-finish-load`, when `offerRebuild`, push
  `core:event:rebuildOffer` `{ reason, sidecarCount, notRecoverable }`.
- **preload**: `rebuildFromSidecars()` on the `core:invoke` passthrough;
  `onRebuildOffer` / `onRebuildProgress` event subscriptions; `RebuildOffer`,
  `RebuildReport`, `RebuildProgress` types re-exported.
- **Renderer** `src/renderer/components/RebuildBanner.tsx` (mounted in `App.tsx`
  next to `StagingConsentBanner`): on `onRebuildOffer` shows "Your library
  database could not be read — N sounds can be rebuilt … with their author and
  License", the not-recoverable line, and a **Rebuild Library** button; during
  the run shows `done / total sidecars`; after, a summary of recovered / orphan
  audio (left on disk) / stray sidecars (removed) / unreadable sidecars, and the
  not-recoverable line again.
- `test/rebuild.test.ts` — 14 tests: `scanSidecars` classification (recovered /
  orphan audio / orphan sidecar / malformed / `.part` ignored) and the
  empty-scan-on-missing-dir case; rebuild reconstructs Library membership +
  metadata with **author and License intact** and the Original resolvable
  (auditionable / draggable); a real `rm` of the DB file (+ WAL) then restart →
  `assessStartup` reports `missing` + `offerRebuild`, and `rebuildFromSidecars`
  restores the Library; re-running is safe (`alreadyPresent`); orphan audio is
  reported, left on disk, and **not** imported; an orphan sidecar is reported and
  its `.json` removed; one malformed sidecar (bad JSON) plus one shape-invalid
  sidecar (missing author) are both reported individually and the valid one still
  recovers; `inspectDbHealth` flags `missing` / `unreadable` / `schema-incomplete`;
  `offerRebuild` is gated on sidecars existing; the not-recoverable line is
  present before (assessment) and after (report); an injected controllable-promise
  runner proves `rebuildFromSidecars` does not block other commands;
  `subscribeRebuildProgress` emits `{0,3}…{3,3}`; and `rebuildWorkerRunner` runs
  the scan on a real `worker_threads` thread (`threadId >= 1`) relaying progress.

### Deferrals / judgement calls (ticket 14)

- **Every sidecar-backed Original is rebuilt as Library membership.** A sidecar
  does not record whether the Sound was saved to the Library or merely Staged
  (ticket 10 writes a sidecar for both). With the database gone that distinction
  is unrecoverable, so rebuild promotes every valid sidecar into the Library —
  over-recovering a handful of auditioned-but-unsaved Sounds is the honest,
  safe failure vs. silently dropping real saves ("which Sounds the user has",
  per the ticket). Not widening the sidecar with an `intent` field keeps the
  ticket-10/11 write paths untouched; a future ticket could add one
  backward-readably.
- **`downloadedAt` is used as `saved_at`.** It is the only timestamp in the
  sidecar; the true save time is in the lost database. Library order after a
  rebuild is therefore download order, not save order.
- **No renderer component test.** Per spec 0001 there are no renderer component
  tests; `RebuildBanner` is straight presentation over the core report and the
  preload event, both covered at the core/contract seam.
- **`unreadable` DB with no sidecars**: `src/main` still moves the corrupt file
  aside and starts fresh (an empty Library beats a crash), but shows no rebuild
  offer — there is nothing to rebuild from. Only `offerRebuild` (DB unusable +
  sidecars present) surfaces the banner.
- **`better-sqlite3` native module** had to be recompiled for this environment's
  Node 24 (`NODE_MODULE_VERSION` 128 → 137) before any test — app/core code
  unchanged; flagged for the human in case CI pins a different Node.

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
