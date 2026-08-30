# 15 — Search filters and sort

**What to build:** A sound designer narrows a search to material that actually meets their
needs before they get attached to something they cannot use — the right duration, the right
technical quality, and a [License](../../../CONTEXT.md) compatible with the work they are
doing.

The License filter is the one that matters most. A commercial user needs to exclude
non-commercial material *before* building a project on it, not discover the problem at
delivery.

**Blocked by:** 05 — SQLite and search cache.

**Status:** ready-for-agent

- [ ] Results can be sorted by relevance, duration ascending and descending, rating, download count, and date created.
- [ ] Results can be filtered by duration range, so a half-second impact is separable from a ten-minute field recording.
- [ ] Results can be filtered by sample rate, bit depth and channel count.
- [ ] Results can be filtered by file type, so uncompressed material can be isolated.
- [ ] Results can be filtered by License, including a single control for "usable in commercial work" that excludes non-commercial material.
- [ ] Filters and sort combine correctly with each other and with the text query.
- [ ] Active filters are clearly visible and individually removable, and can be cleared in one action.
- [ ] Filter and sort state forms part of the search cache key, so a filtered query is cached and served independently.
- [ ] Changing a filter does not lose the user's place in the query or require retyping it.
- [ ] Filters that eliminate all results say so plainly and suggest which filter to relax.
- [ ] Filter and sort state persists across app restarts.
- [ ] Tests cover: each filter dimension produces correctly constrained requests; filters and sort compose; the cache key includes filter and sort state so differently-filtered queries do not collide.
