# 08 — Staged download on audition

**What to build:** A sound designer presses play on a search result, and a moment or two
later — while they are still listening — the real [Original](../../../CONTEXT.md) is on
disk and ready to be dragged. They never asked for it and never had to.

Auditioning streams the [Preview](../../../CONTEXT.md) and simultaneously enqueues the
Original for download. The resulting file is [Staged](../../../CONTEXT.md): a complete
Original on disk that is not part of the [Library](../../../CONTEXT.md). See
[ADR-0003](../../../docs/adr/0003-auditioning-stages-a-download.md).

This has real costs that must be bounded here, not later. Each staged download is recorded
by Freesound as that user having downloaded the sound, and spends part of a 2000/day
budget. A user skimming a result list must not queue dozens of files.

**Blocked by:** 04 — Audition via Preview; 05 — SQLite and search cache; 07 — OAuth sign-in and sign-out.

**Status:** ready-for-agent

- [ ] Auditioning a Sound enqueues a download of its Original in the background, while Preview playback proceeds unaffected.
- [ ] Downloaded Originals are written to a flat, app-managed content store named by Freesound sound id, per [ADR-0002](../../../docs/adr/0002-database-is-the-truth.md).
- [ ] The download queue enforces a concurrency limit so browsing does not saturate the connection.
- [ ] Moving past a Sound quickly cancels its in-flight download, so skimming a list does not queue dozens of files.
- [ ] Each row clearly indicates whether its Original is not started, downloading, ready, or failed.
- [ ] Transient failures retry a small number of times with backoff.
- [ ] A permanently failed download is reported on the Sound's row as unavailable, distinct from slow.
- [ ] Staging requires a signed-in Account; while signed out, auditioning still works and staging simply does not occur.
- [ ] The user is informed, before this behaviour first takes effect, that auditioning downloads sounds against their Freesound account's record.
- [ ] Staged state is recorded in the database with size and last-accessed time, ready for eviction in ticket 10.
- [ ] Tests cover: auditioning enqueues a download; moving on cancels it; concurrency is capped; a Sound becomes ready once its Original lands; transient failure retries and permanent failure surfaces; nothing is staged while signed out.
