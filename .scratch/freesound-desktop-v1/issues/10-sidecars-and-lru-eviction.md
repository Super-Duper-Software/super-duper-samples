# 10 — Sidecars and LRU eviction

**What to build:** Sounds the user auditioned but never kept are cleaned up on their own,
invisibly, so the disk does not fill with material they did not choose. And every
downloaded [Original](../../../CONTEXT.md) carries its identity alongside it on disk, so
the [Library](../../../CONTEXT.md) can never become an unrecoverable folder of
numerically-named audio files.

The sidecar is **mandatory**, not an optimisation. It is the sole mechanism by which the
Library can be rebuilt if the database is lost, and it is the only thing standing between a
corrupt database and rubble. See
[ADR-0002](../../../docs/adr/0002-database-is-the-truth.md).

[Staging](../../../CONTEXT.md) is invisible when it works. The user never manages it, is
never asked about it, and is never told a Staged sound was evicted.

**Blocked by:** 08 — Staged download on audition.

**Status:** ready-for-agent

- [ ] Every downloaded Original is written with a sidecar JSON file carrying its Freesound metadata, author, [License](../../../CONTEXT.md) and source URL.
- [ ] The sidecar is written atomically alongside the audio, so a file never exists without one after a successful download.
- [ ] Staging is bounded by a configurable byte budget.
- [ ] When the budget is exceeded, Staged sounds are evicted least-recently-accessed first.
- [ ] Eviction never removes a Sound that is in the Library.
- [ ] Eviction never removes a file that a live [Drag-Out](../../../CONTEXT.md) hardlink still refers to.
- [ ] Eviction runs without user involvement and without notification.
- [ ] Evicting a Sound removes its audio and its sidecar together, leaving no orphans.
- [ ] Current disk usage is visible in the app, broken down between Staged and Library.
- [ ] The user can clear Staged material on demand to reclaim space, without affecting the Library.
- [ ] Long-running eviction work does not block the interface.
- [ ] Tests cover: a sidecar accompanies every download; exceeding the budget evicts least-recently-used first; eviction skips Library sounds; eviction skips files with live hardlinks; audio and sidecar are removed together; clearing Staged material leaves the Library untouched.
