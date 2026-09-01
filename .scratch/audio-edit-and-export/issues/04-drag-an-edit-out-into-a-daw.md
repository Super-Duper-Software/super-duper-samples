# 04 — Drag an Edit out into a DAW

**What to build:** A sound designer drags an Edit straight out of the window into Logic,
Audacity, Final Cut, Ableton or the file manager — exactly as they drag a downloaded
Original. It arrives under the Edit's name (not a numeric id) at the format and quality they
chose. This is the reason the feature exists: an Edit is a first-class draggable
[Drag-Out](../../../CONTEXT.md) source.

**Blocked by:** 01 — Export a Library Sound as an Edit.

**Status:** done — code + tests (`test/drag.test.ts`)

- [x] `startDrag` accepts an Edit's negative id (alone or mixed with real Sound ids).
- [x] The path handed to `DragHost` for an Edit is a hardlink to the Edit's own file under its effective name as the basename — not the content-store path, not a Preview.
- [x] The hardlink is created under the same temp-directory rule as an Original's Drag-Out (ADR-0002), reusing the existing name-collision disambiguation.
- [x] A Drag-Out requested for an Edit whose render has not finished is refused with a clear message, the same way an un-Staged Original's drag is refused — never served a fallback.
- [x] `endDrag` releases any hold placed for an Edit.
- [x] Tests at the core seam (recording `DragHost`) cover: the dragged path for an Edit is a hardlink with a human basename derived from the Edit's name; it is the Edit's file and not the store path; a drag before the render completes is refused; a mixed drag of a Sound and an Edit hands over both.

## Notes for the frontier

- `resolveDragSource` in `dragController.ts` is the only new seam: for a negative id it reads
  `local_path` via `getEditFieldsByIds` instead of deriving an id-named content-store path.
  Everything downstream (hardlink, disambiguation, icon, registry) is unchanged and already
  generic over the id's sign.
- An Edit's `sounds` + `local_path` row is inserted only once its render is fully finished
  (ticket 01's `createEdit`), so "drag before the render completes" and "drag an unknown id"
  are the same code path: `getSoundsByIds` returns nothing and `OriginalNotStagedError` fires.
  No separate render-status tracking was needed.
- `endDrag`/`DragRegistry` needed no changes — it was already keyed on a plain numeric id with
  no assumption about sign.
