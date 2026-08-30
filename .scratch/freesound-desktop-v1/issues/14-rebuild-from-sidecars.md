# 14 — Rebuild from sidecars

**What to build:** The user's [Library](../../../CONTEXT.md) survives losing the database. A
bad shutdown, a corrupted file or a botched migration does not turn a carefully gathered
collection into a folder of anonymous, numerically-named audio files.

This is the safety net that [ADR-0002](../../../docs/adr/0002-database-is-the-truth.md)
promises in exchange for making the database authoritative. Without it, the decision to put
all organisation in SQLite is a single point of total loss.

Not everything is recoverable, and the ticket must be honest about that. Custom names,
custom tags and [Collection](../../../CONTEXT.md) membership live only in the database and
are lost. What is recovered is the Library itself: which [Sounds](../../../CONTEXT.md) the
user has, who made them, and under what [License](../../../CONTEXT.md).

**Blocked by:** 10 — Sidecars and LRU eviction; 11 — Library: save, view, delete.

**Status:** ready-for-agent

- [ ] A rebuild command reconstructs Sound metadata and Library membership from the sidecar files in the content store alone.
- [ ] After deleting the database entirely and restarting, the user's Library is present, browsable, auditionable and draggable.
- [ ] A missing or unreadable database is detected on startup and the user is offered a rebuild rather than shown a broken app or an empty Library.
- [ ] An audio file present without a sidecar is reported to the user, not silently dropped and not silently imported without attribution.
- [ ] A sidecar present without its audio file is reported and cleaned up.
- [ ] A malformed sidecar is reported individually and does not abort the whole rebuild.
- [ ] The user is told plainly, before and after, that custom names, custom tags and Collections are not recoverable by rebuild.
- [ ] Rebuild reports what it recovered and what it could not.
- [ ] Rebuild runs off the main thread and shows progress for large libraries.
- [ ] Tests cover: deleting the database and rebuilding reconstructs the Library from sidecars; orphan audio is reported rather than dropped; orphan sidecars are reported; one malformed sidecar does not abort the rebuild; rebuilt entries carry correct author and License.
