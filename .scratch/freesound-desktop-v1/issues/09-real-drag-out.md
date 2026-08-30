# 09 — Real drag-out

**What to build:** **The product exists after this ticket.** A sound designer searches,
presses play, and drags the result straight from the app into Logic Pro's arrange view.
The whole reason for building any of this.

Only an [Original](../../../CONTEXT.md) already on disk may be dragged. Because the content
store names files by sound id, the store path is never dragged directly — dropping it would
put a region called `442827.wav` into the user's session. Instead the file is hardlinked
into a temporary directory under a sanitised, human-readable name derived from the Sound,
and *that* path is handed to the OS. Hardlinking costs no disk space and means the dropped
file survives later eviction of the staged Original. See
[ADR-0002](../../../docs/adr/0002-database-is-the-truth.md).

**A [Preview](../../../CONTEXT.md) must never be handed to the operating system under any
circumstances.** Dragging the preview mp3 and swapping in the Original afterwards will look
tempting because it makes the interaction feel instant — it is forbidden. The receiving
application copies the file on drop, so the swap always arrives too late and the user
silently ships 128kbps audio in finished work. See
[ADR-0003](../../../docs/adr/0003-auditioning-stages-a-download.md).

`DragHost` exists as a named boundary wrapping the single OS call, so that what the app
hands to the operating system is observable in tests.

**Blocked by:** 01 — Drag-out platform spike; 08 — Staged download on audition.

**Status:** ready-for-agent

- [ ] A Sound whose Original is on disk can be dragged from the app into Logic Pro, Audacity, Final Cut, Ableton and the system file manager, delivering the Original at native quality.
- [ ] `DragHost` wraps the single OS drag call as the app's only such boundary.
- [ ] On drag start the Original is hardlinked into a temporary directory under a sanitised filename derived from the Sound, preserving the original extension; the store path is never dragged directly.
- [ ] Filename collisions within the temporary directory are disambiguated so two similarly-named Sounds arrive as distinct files.
- [ ] The drag icon is the Sound's waveform, and is never empty.
- [ ] Attempting to drag a Sound whose Original is not yet on disk is refused with a visible explanation — never a silent no-op, and never a substituted Preview.
- [ ] A dropped file continues to work after the app quits and after the staged Original is evicted.
- [ ] Multi-Sound drag is offered only on platforms where ticket 01 verified that every file is delivered; where it was not, the interface does not offer it.
- [ ] Tests assert the path handed to `DragHost` has a human-readable basename derived from the Sound; is a hardlink to the content store rather than a copy or the store path; is the Original and never a preview URL; still resolves after the staged Original is evicted; and that a drag requested before the Original is present is refused rather than served a Preview.
- [ ] Manual verification against every target application on both macOS and Windows is recorded.
