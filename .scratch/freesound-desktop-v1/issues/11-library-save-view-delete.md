# 11 — Library: save, view, delete

**What to build:** A sound designer keeps a [Sound](../../../CONTEXT.md) with one keystroke,
finds it again instantly in a Library view that works the same way the search list does,
and can prune material they no longer need.

[Library](../../../CONTEXT.md) membership is a statement of *intent*, not of disk presence.
A [Staged](../../../CONTEXT.md) sound is equally on disk but is not in the Library. Saving
therefore promotes a Staged sound by writing a database row — the file is not moved or
copied, which is what makes saving instant. See
[ADR-0003](../../../docs/adr/0003-auditioning-stages-a-download.md).

The Library must be fully usable with no internet connection.

**Blocked by:** 08 — Staged download on audition; 09 — Real drag-out.

**Status:** ready-for-agent

- [ ] A single keystroke saves the selected Sound to the Library.
- [ ] Saving a Staged sound is instant and does not move or copy the file.
- [ ] Saving is idempotent — saving an already-saved Sound is harmless and does not duplicate it.
- [ ] Search results clearly indicate which Sounds are already in the Library, so the user does not download the same thing twice.
- [ ] The Library is browsable in the same virtualized list interface as search results, with the same rows, playback and drag behaviour.
- [ ] Library sounds can be auditioned and dragged out exactly as search results can.
- [ ] Sounds can be sorted by the date they were saved, so the user can find what they gathered for a particular project.
- [ ] Deleting a Sound from the Library removes both its database row and its files, reclaiming disk space, and asks for confirmation first.
- [ ] A Library Sound can be revealed in Finder or Explorer.
- [ ] A Library Sound's page can be opened on freesound.org.
- [ ] The Library is fully browsable, auditionable and draggable with no internet connection.
- [ ] Signing out leaves the Library intact and fully usable.
- [ ] Tests cover: saving promotes a Staged sound without moving the file; saving is idempotent; deleting removes row and files; a Sound in the Library is reported as such in search results; the Library functions with the gateway unavailable.
