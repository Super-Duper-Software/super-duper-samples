# 05 — SQLite and search cache

**What to build:** Repeating a search, or navigating back to a previous one, is instant and
costs nothing. Typing a query fires far fewer requests than it has keystrokes, and the next
page of results is already loading before the user reaches the bottom.

This ticket introduces the database that everything after it depends on. Per
[ADR-0002](../../../docs/adr/0002-database-is-the-truth.md) the database is authoritative;
here that begins with the search cache, but the schema, migration approach and
off-main-thread access pattern established now are what the
[Library](../../../CONTEXT.md) will be built on.

Freesound allows 60 requests per minute and 2000 per day. Caching is not a performance
nicety — it is what makes sustained browsing possible within that budget.

**Blocked by:** 03 — Result rows and virtualized list.

**Status:** ready-for-agent

- [ ] SQLite is set up with a migration mechanism, and is never accessed from the renderer's thread.
- [ ] Search input is debounced so that rapid typing collapses into few requests.
- [ ] Result pages are cached keyed by the full query, including all parameters, and served from cache without any gateway call.
- [ ] Returning to a previous search restores results instantly with no network request.
- [ ] Sound metadata from search responses is persisted, so it is available to later tickets without re-fetching.
- [ ] The page after the one being viewed is prefetched as the user scrolls.
- [ ] A 429 response surfaces to the user as throttling, naming when they may retry — not as a generic failure.
- [ ] A connectivity failure is reported as such and is distinguishable from an empty result set.
- [ ] Tests cover: debouncing collapses rapid queries into few gateway calls; a repeated query makes no gateway call; a result page costs exactly one gateway call; 429 surfaces as throttling; cached and live results are identical in shape.
