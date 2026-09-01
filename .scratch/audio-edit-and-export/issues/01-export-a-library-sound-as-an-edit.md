# 01 — Export a Library Sound as an Edit

**What to build:** A sound designer picks a Sound already in the
[Library](../../../CONTEXT.md) whose [Original](../../../CONTEXT.md) is on disk and exports
it as an **Edit** — a new local audio file under a name they chose. The Edit appears in the
Library straight away as its own item, plays and filters like any other, carries the
original Sound's [License](../../../CONTEXT.md), author and Freesound URL, and can be
deleted independently. Producing it spends nothing against the Freesound download quota.

This ticket is the whole-file, single-format path — no trimming and no format conversion
yet (that is ticket 02). It establishes the schema, the render seam and the Edit's place in
the Library. See [ADR-0005](../../../docs/adr/0005-an-edit-is-a-derived-local-sound.md).

**Blocked by:** None — can start immediately.

**Status:** done — code + tests (`test/edits.test.ts`, `test/db.migrations.test.ts`)

- [x] A new append-only migration adds `derived_from`, `edit_spec` and `local_path` (all nullable) to the Sounds table; an existing up-to-date database migrates with no backfill.
- [x] A new core command creates an Edit from a parent Sound id plus an edit spec, rendering the source through an injected `audioRenderRunner` seam — the same injection shape as the peak and rebuild runners. The core imports no `electron` and spawns no binary.
- [x] `makeTestCore` accepts a fake `audioRenderRunner` that can simulate a fast success, a slow success with progress, an abort, and a failure.
- [x] On success the Edit's file and its mandatory sidecar are written to the content store under a parent-derived, human name (`<parentId>-edited.<ext>`, then `-edited-2`, …) — never the `<id>.<ext>` scheme.
- [x] A Sounds row with a negative id is inserted, carrying the parent's License name/url, author and Freesound URL; a Library entry row is inserted at the same time (an Edit is born in the Library, never Staged).
- [x] The sidecar records `derivedFrom` and `editSpec` alongside the existing fields.
- [x] `listLibrary` and `filterLibrary` return Edits; a format filter matches an Edit on its own format.
- [x] `LibrarySound` exposes `derivedFrom` and `editSpec`; an unrenamed Edit's effective name is `edited` / `edited (N)`, chosen by a pure helper that scans existing Edit names for that parent.
- [x] `deleteFromLibrary` on an Edit's id removes its row and deletes its file, and leaves the parent Sound and its Original untouched.
- [x] `setCustomName`, `setLibraryTags`, `revealInFinder` and `openFreesoundPage` accept an Edit's id; `openFreesoundPage` opens the parent Sound's page.
- [x] Creating an Edit never calls the gateway and does not change `getDownloadsInLast24h`.
- [x] Creating an Edit for a parent whose Original is not on disk, or an unknown parent, is a silent no-op.
- [x] `cancelEdit` during a render leaves no row, no file and no sidecar behind.
- [x] Tests at the core seam cover: the Edit file + sidecar land in the store; the negative-id row and Library entry are written with the inherited License/author/URL; a second Edit of the same parent is named `edited (2)`; the Edit shows in `listLibrary`; deleting it removes row + file and spares the parent; the gateway is never called; an absent-Original parent is a no-op; `cancelEdit` cleans up.

## Notes for the frontier

- `revealInFinder` has no dedicated core command yet (ticket 18's `getContentPath` backs
  "reveal in Finder" from `src/main`) — it already resolves an Edit's `local_path` correctly.
- No `src/main` / preload wiring in this ticket: `audioRenderRunner` and `onEditProgress` are
  core-only seams, tested via `makeTestCore`. Ticket 02 wires the real `ffmpeg-static` runner;
  preload/renderer wiring lands with the Edit view (07/08).
- `nextEditId` mints negative ids locally (one less than the current minimum); ids are never
  sent anywhere external, matching the rebuild-from-sidecars precedent (ticket 06 re-mints them).
