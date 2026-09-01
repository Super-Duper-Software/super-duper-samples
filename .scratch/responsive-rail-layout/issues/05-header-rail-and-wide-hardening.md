# 05 — Header: rail structure + wide hardening

**What to build:** The header stops going squishy. At normal width it tightens so it never
wraps down to the breakpoint; in the rail layout it stacks into three tidy rows. The
wordmark becomes a small logo slot, secondary actions move into a header `⋯`, and the live
result count moves into the list body when docked.

**Blocked by:** 01 — Breakpoint infrastructure; 02 — `OverflowMenu` primitive.

**Status:** ready-for-agent

- [ ] The `<h1>` wordmark is replaced by a small logo slot — an `<img src="brand/logo.svg">` (or equivalent) that renders nothing gracefully until the asset exists — placed left of the tabs in both layouts.
- [ ] A header `⋯` exists in **both** layouts containing Sign out, Keyboard shortcuts, and View logs. The standalone `Sign out` button and the standalone `?` button are gone; the `?` **key** still opens the shortcuts dialog.
- [ ] Signed-out state keeps its `Sign in` button inline in both layouts.
- [ ] **Wide hardening:** the `AuthBar` username gets `min-w-0` + truncation; below ~820px it shows the username without the "Signed in as" prefix. `DownloadQuota` abbreviates to "N ↓" below ~900px with the full sentence kept in `title`; its low/exhausted colour states are unchanged.
- [ ] The wide header does not wrap to a second row at any width from full down to 760px.
- [ ] **Rail structure:** row 1 = logo · abbreviated `DownloadQuota` · header `⋯`; row 2 = Search / Library / Collections as a full-width segmented control, equal thirds; row 3 = the existing context bar (search input / Library controls / Collections breadcrumb), allowed to wrap.
- [ ] In the rail layout the live result count (search results / Library count / Collection count) renders at the top of the list body instead of in the header; in the wide layout it stays in the header.
- [ ] Switching across 760px reflows the header live in both directions.
- [ ] `tsc --noEmit` and `electron-vite build` clean. Manual check at ~700px, ~820px, ~900px and the 360px floor; add header changes to `PROGRESS.md` "Needs manual verification".
