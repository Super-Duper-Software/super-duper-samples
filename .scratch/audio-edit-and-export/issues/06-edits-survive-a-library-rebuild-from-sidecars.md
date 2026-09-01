# 06 — Edits survive a Library rebuild from sidecars

**What to build:** If the database is ever lost, rebuilding the Library from the content
store's sidecars brings the user's Edits back too — not just their downloaded Originals. An
Edit whose parent Sound was already deleted is still fully credited, because everything
needed to attribute it lives in its own sidecar.

**Blocked by:** 01 — Export a Library Sound as an Edit.

**Status:** done — code + tests (`test/edits.rebuild.test.ts`, `test/rebuild.test.ts`)

- [x] `rebuildFromSidecars` recognises a sidecar carrying `derivedFrom` and reconstructs a negative-id Sounds row plus a Library entry row for it.
- [x] The rebuilt Edit keeps its inherited author, License and Freesound URL, its format details and its `editSpec`; the negative id is re-minted locally (ids are not stable across a rebuild and nothing external references them).
- [x] `local_path` is re-derived to point at the Edit's file in the store.
- [x] The rebuild report counts recovered Edits, and reports an Edit sidecar with no audio file the same way it reports an orphan sidecar for a Sound.
- [x] Custom names, custom tags and Collection membership for Edits are gone after a rebuild, consistent with the existing rebuild contract.
- [x] Tests at the core seam cover: after deleting the database and rebuilding, an Edit created earlier is back in `listLibrary` with its inherited License and its trimmed duration; an Edit whose parent Sound is absent is still returned and still attributable; an Edit sidecar with a missing file is reported, not silently dropped.

## What landed

- `scanSidecars.ts` now recognises TWO sidecar filename shapes: a Sound's
  `<id>.json` and an Edit's `<parentId>-edited[-N].json` (`nextEditPaths`).
  Pairing switched from an id parsed out of the filename to the sidecar's own
  recorded `file.name` — an Edit's audio basename doesn't start with its
  (negative) sound id, so the old id-keyed lookup could never have found it.
  `validateSidecar` now also requires `file.name`, and requires `editSpec`
  whenever `derivedFrom` is present.
- `rebuildService.ts` branches on `sidecar.derivedFrom`: a Sound goes through
  the existing `upsertSound` path unchanged; an Edit re-mints its id via
  `nextEditId` (the sidecar's old id is never reused — nothing external
  references it) and calls `insertEditSoundRow` with `localPath` re-derived
  from where the scan actually found the file on disk.
- Idempotency for Edits can't key off the old id (it's re-minted every run), so
  added `findEditIdByLocalPath` (`db/edits.ts`) — a second rebuild recognises
  an already-recovered Edit by its file path and leaves it alone.
- The parent Sound is never required to exist: an Edit's sidecar is
  self-contained (author, License, URL, format, `editSpec` all live in it), so
  `derived_from` is allowed to point at nothing, same as production already
  tolerates (no FK on that column).
