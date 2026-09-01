# Spec 0003 — A thin "rail" layout for docked use

Status: ready-for-agent
Vocabulary: see [CONTEXT.md](../../CONTEXT.md). Terms defined there — Sound, Preview,
Original, Staged, Library, Collection, Account, License, Attribution Manifest, Drag-Out —
are used with their glossary meanings. This spec adds no domain terms. It does record one
UI-vs-glossary split already written into CONTEXT.md: the control that generates an
**Attribution Manifest** is labelled **Credits** in the interface; the artifact and the
term in code and docs stay "Attribution Manifest".
Constraints: see [ADR-0006](../adr/0006-a-thin-rail-layout-for-docked-use.md) (the
breakpoint, the `useViewport` choice, the "`⋯` is the overflow" principle) and
[ADR-0005](../adr/0005-an-edit-is-a-derived-local-sound.md) (the Edit view, which this
spec leaves untouched).

## Problem Statement

I run this next to my DAW. The first thing I do with any tool like this is shove it to one
side of the screen — docked left or right, or snapped to a half — so it is out of the way
of the thing I am actually working in. I want to glance at it, audition a few Sounds, drag
one into my session, and get back to work.

The moment I make the window narrow, it falls apart. The top bar goes squishy: the title,
the tabs, the "downloads left" pill, "Signed in as …" and the little `?` all start
fighting for the same row and wrap into a ragged mess. The result rows are worse — the
waveform, the row of Rename / Reveal / Page / Remove buttons and the licence chip overflow
the row, and the licence chip is a different width on every row so nothing lines up. The
transport bar at the bottom wraps into three or four lines. Splice sits happily in a thin
strip beside a DAW; this cannot.

Separately, even at a normal width the rows feel busy. Every Library row is carrying its
own little form — custom-tag chips, a `+ tag` input, the full dump of Freesound's tags —
plus four or five buttons and a couple of helper sentences in the bar above. It is more
than I need to look at while I am scanning for a sound.

## Solution

The app gets a **second layout, "rail"**, for narrow windows, and both layouts get pared
back.

A single breakpoint flips the whole shell. Above it the layout is "wide" — today's
arrangement, tightened so it never wraps down to the breakpoint. At or below it the shell
is "rail": a genuinely different arrangement built to sit in a thin strip. The window can
now be dragged narrower than before to make that strip possible.

In rail the header stacks into a tight utility row (logo, downloads indicator, an overflow
menu), a full-width segmented tab control, and the context bar (search box / Library
controls / Collection breadcrumb). Result rows become two compact lines — play, name and
an overflow menu on top; a small waveform, duration, format and state below — with every
secondary action moved into the row's overflow menu. The transport bar becomes one row —
play, the current Sound's name, the Support heart, and an overflow menu holding Stop, Loop,
Auto-advance and volume — above the scrub waveform.

The pare-back applies in both layouts. Each Sound's trailing licence area becomes one
fixed-width slot showing either the non-commercial warning or the licence chip, so rows
align. Every row keeps only its one or two most important buttons visible; the rest —
Rename, Reveal, Page, Add to collection, and the destructive Remove — move into a `⋯`
overflow menu. Tag *authoring* leaves the row: custom tags show read-only, and adding or
removing them happens from the overflow menu or the Edit view. Freesound's own tag list
comes off the row entirely and lives in a tooltip. The helper sentences under the Library
and Collections bars are gone. "Generate manifest" becomes "Credits".

The Edit view is deliberately exempt. It is a "make the window big and work on it"
experience, not something to use docked, and it stays exactly as it is.

## User Stories

### Docking and the breakpoint

1. As a sound designer, I want to dock this window to one side of my screen beside my DAW, so that I can keep it in view without it covering my session.
2. As a sound designer, I want the window to shrink to a genuinely thin strip, so that it takes as little horizontal space as a Splice-style browser.
3. As a sound designer, I want the layout to switch to a thin-strip arrangement automatically when the window gets narrow, so that I do not have to configure anything.
4. As a sound designer, I want the switch to happen at a width where the normal layout would otherwise start to look cramped, so that I never see a squished in-between state.
5. As a sound designer, I want the layout to switch back to the normal arrangement when I widen the window again, so that docking is a reversible glance-and-go move.
6. As a sound designer, I want the layout to react live as I drag the window edge, so that resizing feels immediate rather than requiring a reload.
7. As a sound designer on a large display, I want a half-width window to stay in the normal layout with room to spare, so that "half screen" is not needlessly downgraded.
8. As a sound designer on a laptop, I want a half-width window to use the thin-strip layout, so that the app is comfortable at the width I actually get.
9. As a sound designer, I want the app to remember its size and position between sessions, so that it comes back where I docked it — including at the new smaller minimum.
10. As a sound designer, I want a restored tiny or off-screen saved size to still be corrected to something usable, so that a bad saved value never strands the window.

### The header, narrow

11. As a sound designer, I want the header to stay to a few tidy rows when the window is thin, so that it does not eat the list.
12. As a sound designer, I want the app title replaced by a small logo mark when space is tight, so that identity costs almost no width.
13. As a sound designer, I want the Search / Library / Collections tabs to remain reachable in the thin layout as a full-width control, so that switching views is still one tap.
14. As a sound designer, I want to still see how many downloads I have left in the thin layout, so that I know where I stand against the Freesound daily limit.
15. As a sound designer, I want the downloads indicator to shorten to just the number when space is tight, with the full explanation still on hover, so that it stays informative without a sentence.
16. As a sound designer, I want secondary header actions — Sign out, keyboard shortcuts, view logs — tucked into one overflow menu, so that the header is not a row of competing controls.
17. As a signed-out user, I want the Sign in button to stay directly visible in every layout, so that the one thing I need to do is never hidden in a menu.
18. As a sound designer, I want the live result count to move to the top of the list in the thin layout, so that the header utility row stays short.
19. As a sound designer, I want the search box to take the full width of the thin window, so that I can see what I typed.

### The header, wide

20. As a sound designer, I want the normal-width header to stop wrapping at any width down to the breakpoint, so that "a bit narrow" never looks broken.
21. As a sound designer, I want "Signed in as <name>" to truncate a long username rather than push other things onto a second row, so that the header holds one line.
22. As a sound designer, I want the username alone (without "Signed in as") once the header gets tight, so that the identity still shows but costs less width.
23. As a sound designer, I want Sign out to live in the header overflow menu in both layouts, so that a destructive-ish session action is not a stray button.
24. As a sound designer, I want the downloads indicator to abbreviate under a certain width in the normal layout too, so that the tightening is consistent.

### Result rows — alignment and pare-back

25. As a sound designer, I want every row's trailing licence area to be the same width, so that the buttons to its left line up from row to row.
26. As a sound designer, I want a row to show either the non-commercial warning or the licence chip, not both, so that the rights signal is one thing in one place.
27. As a commercial user, I want a non-commercial Sound to still stand out clearly with its own distinct pill, so that I do not accidentally use it in paid work.
28. As a sound designer, I want each row to show only its one or two most important actions, so that scanning a list is not scanning a toolbar.
29. As a sound designer, I want the rest of a row's actions in a `⋯` menu on that row, so that they are one click away without being on screen all the time.
30. As a sound designer browsing search results, I want the Download / Downloaded button to stay directly on the row, so that acquiring a Sound is always one click.
31. As a sound designer browsing search results, I want "open the Freesound page" and "add to a collection" in the row's `⋯` menu, so that the row stays about the Sound, not about navigation.
32. As a sound designer in my Library, I want the Edit action directly on the row, so that the one action unique to this app is never buried.
33. As a sound designer in my Library, I want Rename, Reveal, Freesound page, Add to collection and Remove in the row's `⋯` menu, so that occasional file-management does not clutter the row.
34. As a sound designer, I want a quick "add this one Sound to a collection" from the row `⋯` menu, so that I do not have to tick a checkbox and use the batch bar for a single Sound.
35. As a sound designer viewing an open Collection, I want "Remove from collection" to stay directly on the row, so that pruning a collection is a single deliberate click.
36. As a sound designer viewing an open Collection, I want Rename, Reveal, page and Add to collection in that row's `⋯` menu, so that the row matches the pared-back Library row.
37. As a sound designer, I want the destructive "Remove from Library" action to sit inside the `⋯` menu rather than as a bare red button on every row, so that I do not fat-finger a deletion while scrolling.

### Result rows — tags

38. As a sound designer, I want my own custom tags shown on the row read-only, so that I can see how I have labelled a Sound at a glance.
39. As a sound designer, I want to add and remove custom tags from the row's `⋯` menu or the Edit view, so that the row is not a live form while I am scanning.
40. As a sound designer, I want Freesound's own tag list off the row, available on hover, so that the row is not dominated by a wall of tags I did not write.

### Result rows — rail

41. As a sound designer, I want a rail-layout row to be two short lines, so that many Sounds fit in a thin window.
42. As a sound designer, I want the rail row's first line to be play, the Sound's name, and a `⋯` menu, so that the essentials are immediate.
43. As a sound designer, I want the rail row's second line to show a small waveform, duration, format and one state token, so that I can still judge a Sound without opening it.
44. As a sound designer, I want a non-commercial Sound to still show its warning token on the rail row, so that a rights problem is visible even in the thin layout.
45. As a sound designer, I want everything else — Edit, Remove, Add to collection, Rename, Reveal, page, licence detail — in the rail row's `⋯` menu, so that the row stays to two lines.
46. As a sound designer, I want to drag a Sound straight out of a rail row into my DAW, so that the thin layout does not cost me the core gesture.
47. As a sound designer, I want to multi-select rows in the rail layout via a "Select" entry in the row `⋯` menu, so that batch add-to-collection is still possible when docked.

### Transport bar

48. As a sound designer, I want the transport bar to stay a single row in the thin layout, so that it does not wrap and steal vertical space from the list.
49. As a sound designer, I want the thin transport row to show play/pause, the current Sound's name and a `⋯` menu, so that I always know what is playing and can reach the rest.
50. As a sound designer, I want Stop, Loop, Auto-advance and the volume slider inside that `⋯` menu, so that they are available without being on the bar.
51. As a sound designer, I want playback status shown as a cue on the play button rather than a text column, so that the bar saves width.
52. As a sound designer, I want the scrub waveform to stay visible above the thin transport row, so that I can still see and click into the Sound I am auditioning.
53. As a sound designer, I want the Support heart to stay visible in every layout, so that the way to support the app is never hidden.

### Filter bar and sub-bars

54. As a sound designer, I want the Sort and Filters controls to sit side by side as two buttons in the thin layout, so that they fit one row.
55. As a sound designer, I want my active filter chips to stay visible below the controls in the thin layout, so that I can see and clear what is constraining the search.
56. As a sound designer, I want the Library and Collections bars to drop their explanatory sentences in both layouts, so that the chrome is quieter.
57. As a sound designer, I want the Library sort-direction toggle to become a compact up/down control in the thin layout, so that it costs little width.
58. As a sound designer, I want "Generate manifest" relabelled "Credits", so that the button says what I get from it.
59. As a sound designer, I want the Credits button to stay a labelled button in both layouts, so that an infrequent, important action is not reduced to a mystery icon.
60. As a sound designer, I want the "‹ All collections" breadcrumb and the open Collection's name to stay visible in the thin layout, so that I know where I am.

### Not regressing

61. As a sound designer, I want keyboard navigation of the results list to keep working in both layouts, so that the thin layout is not mouse-only.
62. As a sound designer, I want the `?` keyboard-shortcuts key to keep working even though the visible `?` button moved into a menu, so that I do not lose the shortcut.
63. As a sound designer, I want the Edit view to be unchanged, so that focused editing still gets the whole window.
64. As a sound designer, I want empty states — no results, empty Library, empty Collection — to read correctly in the thin layout, so that they are not mistaken for a broken screen.
65. As a sound designer, I want the rebuild-from-sidecars banner and the notification host to still display sensibly in the thin layout, so that important messages are not cut off.

## Implementation Decisions

### The breakpoint

- **One flip point at `max-width: 760px`.** At or below it the shell is "rail"; above it,
  "wide". There is no intermediate tier — "wide" is hardened to hold to 760, "rail" is a
  distinct arrangement.
- Chosen so a half-width dock on a 1080p-or-smaller display lands in rail while a
  half-width dock on a 1440p+ display stays wide. Rationale and rejected alternatives
  (multi-tier; CSS-only; harden-only-no-rail) are in ADR-0006.

### Window minimum

- `MIN_WINDOW_WIDTH` in `src/core/uiState.ts` drops from **640 to 360**.
  `MIN_WINDOW_HEIGHT` is unchanged at 480.
- 360 is the width the rail layout is designed against; below it the two-line row and the
  segmented tab bar stop working. Not lowered further.
- The main-process `BrowserWindow` `minWidth` and the saved-bounds clamp both already read
  this constant (`src/main/index.ts`), so no other change is needed for the drag-resize
  floor to move.
- `normaliseUiState` / the saved-bounds validation continue to reject an under-floor or
  off-screen saved window; only the numeric floor moves.

### How the breakpoint is read

- A pure helper owns the decision: `layoutForWidth(width: number): 'wide' | 'rail'`, with
  an exported `RAIL_MAX_WIDTH = 760`. This is the single new seam.
- A `useViewport()` renderer hook wraps one `matchMedia('(max-width: 760px)')` listener,
  held in one place (hook module or a tiny store), and exposes `isRail: boolean`. The hook
  itself is a thin `matchMedia` wrapper and is not unit-tested; the pure helper is.
- Components branch in JS — `isRail ? <RailX/> : <WideX/>` — for structural divergence.
  Tailwind responsive utilities are still fine for incidental padding/size tweaks that do
  not need a branch. Chosen over pure CSS media queries because the layouts differ in
  structure, not just spacing (ADR-0006).

### The `⋯` overflow menu

- A new **`OverflowMenu`** renderer primitive: portal-based `role="menu"`, keyboard
  navigable (arrow keys, Home/End, Enter/Space to activate), closes on Escape,
  outside-click, and after an item runs — except items that open a nested picker. Focus
  returns to the trigger on close. `aria-haspopup="menu"`.
- Modelled on the existing `CollectionMenu` portal/positioning approach. `CollectionMenu`
  and `FilterPopover` are unchanged. "Add to collection" inside an `OverflowMenu` opens
  `CollectionMenu` as a nested step.
- Anchored below-right of its trigger; flips above when there is no room below.
- This primitive is the single mechanism by which any bar or row sheds actions. It is used
  by: each result-row variant, the transport bar, the header, and (rail) the Collections
  sub-bar.

### Result row — trailing licence slot

- One **fixed-width slot** (~`w-24`, right-aligned, always rendered even when empty) holds
  *either* the `⚠ Non-commercial` pill *or* the `LicenseChip`, never both. A `CC-BY-NC`
  chip is redundant next to a non-commercial pill.
- The brand rule in `LicenseChip` (differ by label + shape, never hue alone; NC gets the
  heavier border) is preserved — NC keeps its own distinct pill, it just occupies the
  shared slot.
- With the trailing column now identical width on every row, the visible action(s) to its
  left align row to row.

### Result row — visible actions vs `⋯` (wide layout)

- **Search variant:** visible — the `Download` / `✓ Downloaded` button (already
  fixed-width). In `⋯` — "Open Freesound page", "Add to collection" (replaces the inline
  `＋ Collection ▾`). The play icon button and whole-row drag are unchanged.
- **Library variant:** visible — `✂ Edit`. In `⋯` — Add to collection, Rename, Reveal,
  Open Freesound page, Remove (the destructive delete-from-Library).
- **Collection variant:** visible — `✂ Edit`, `Remove from collection` (frequent,
  non-destructive here). In `⋯` — Add to collection, Rename, Reveal, Open Freesound page.

### Result row — tags

- Custom tags render as read-only chips on the row (no inline remove affordance, no inline
  `+ tag` input).
- Tag add/remove moves to `⋯` → "Edit tags" and remains available in the Edit view.
- Freesound's own tag list is removed from the row body; it stays as a `title` tooltip
  (and in the Edit view).

### Result row — rail layout

- Two lines. Line 1: play icon · name (truncate, fills width) · `⋯`. Line 2: small
  waveform (~`h-6 w-16`) · duration · format · one state token (staging chip / `✓`
  downloaded / `⚠ NC`) · read-only custom-tag chips (overflow hidden).
- The shrunken waveform stays on the row (identity cue).
- All other actions — Edit, Remove, Add to collection, Rename, Reveal, page, licence
  detail — are in the row `⋯`.
- The multi-select checkbox is not shown inline in rail; a "Select" toggle in `⋯` drives
  the same multi-select state used by the batch add-to-collection bar.
- Whole-row drag-out is unchanged.

### Transport bar — rail layout

- One row: play/pause · current-sound name (truncate) · `♥` glyph only (no "Support"
  text; tooltip kept) · `⋯` holding Stop, Loop, Auto-advance and the volume slider.
- The scrub waveform stays, at ~`h-12` (down from `h-16`).
- The `w-28` status-label column is replaced by a colour/spinner cue on the play button.
- Wide layout transport is unchanged except that it, too, must not wrap down to 760 (it
  largely already collapses; verify).

### Header

- The `<h1>` wordmark is replaced by a small logo slot — an `<img>` pointing at
  `brand/logo.svg` (asset does not exist yet; it renders empty/nothing until it lands).
  Present left of the tabs in both layouts.
- A header **`⋯`** exists in **both** layouts, holding: Sign out, Keyboard shortcuts (the
  `?` key binding is unchanged), View logs. `Sign out` is no longer an inline button.
- Signed-out state keeps its `Sign in` button inline in both layouts.
- **Wide hardening:** `AuthBar` username gets `min-w-0` + `truncate`; below ~820px it
  shows the username without the "Signed in as" prefix. `DownloadQuota` abbreviates to
  "N ↓" below ~900px with the full sentence retained in `title`; its low/exhausted colour
  states are unchanged. The live result count stays in the header in wide.
- **Rail structure:** row 1 (utility) — logo · abbreviated `DownloadQuota` · header `⋯`.
  Row 2 — Search / Library / Collections as a full-width segmented control, equal thirds.
  Row 3 — the existing context bar (search input / Library controls / Collections
  breadcrumb), allowed to wrap. The live result count moves out of the header to the top
  of the list body in rail only.

### Filter bar and sub-bars

- **FilterBar (rail):** `Sort ▾` and `Filters ▾` as two equal-width buttons on one row;
  the active-filter chip row stays below and wraps; the `w-44` fixed sort select becomes
  fluid. Minimal change otherwise.
- **Library sub-bar (both layouts):** drop the helper sentence ("· select a row and press
  Delete …"). Keep the sort-direction toggle + `LibraryFilterBar`. Rail: the toggle
  becomes an `↑`/`↓` icon.
- **Collections sub-bar (both layouts):** drop the trailing sentence ("· removing a sound
  here keeps it in your Library"). Keep the `‹ All collections` breadcrumb, the Collection
  name, the sort-direction toggle, and the Credits button. Rail: the direction toggle
  becomes an icon; Credits stays a labelled button.

### "Credits" rename

- The button currently labelled "Generate manifest" becomes **"Credits"** in the UI only.
- The generated artifact, the panel heading/output, `CONTEXT.md`, ADRs and all code keep
  the term **Attribution Manifest**. CONTEXT.md § Attribution Manifest already records
  this split.

### Out-of-band

- The Edit view (`EditView`, ADR-0005) is not modified. It is not subject to the
  breakpoint and keeps its current full-bleed layout.
- The `RebuildBanner` and `NotificationHost` must remain legible in rail (verify; expected
  to need only minor padding/wrapping tweaks).

## Testing Decisions

### What makes a good test here

Per spec 0001 § Testing Decisions and spec 0002: a test drives a stable seam and asserts
on observable outcomes, survives a rewrite of the module it covers, and fails only when a
user-visible promise breaks. It does not assert on DOM structure, class names, or computed
layout.

### Where the tests attach

- **Existing seam, modified — `uiState` saved-window validation.** The `MIN_WINDOW_WIDTH`
  change is the only core-owned behaviour. `normaliseUiState` already rejects an
  under-floor / off-screen saved window and `test/shell-polish.test.ts` already exercises
  that ("rejects a bad view, a non-string query and a tiny / offscreen window"). Update
  the boundary cases to the new 360 floor: a 360×480 saved window is now accepted; a
  sub-360 width is still rejected. **No new seam.**
- **One new pure-helper seam — `layoutForWidth` / `RAIL_MAX_WIDTH`.** Unit test: widths at
  and below 760 resolve to `rail`; 761 and above resolve to `wide`; the boundary is
  covered exactly. Prior art: `test/region-geometry.test.ts`, `test/edit-spec-builder.test.ts`.
- **No renderer component tests, no jsdom-layout assertions, no Playwright** — consistent
  with spec 0001. `useViewport`, `OverflowMenu`, the rail/wide header, rows, transport and
  sub-bars are verified manually.
- If any store gains state as part of this work (not anticipated — `useViewport` is
  expected to be hook-local), a pure state-shape check in the style of
  `test/renderer.transport.test.ts` is the right home for it.

### Manual GUI verification

Add a checklist to `PROGRESS.md` "Needs manual verification" (prior art:
`docs/findings/0002-drag-out-manual-verification.md`). At minimum, at the 360px floor and
at ~700px and ~900px, in a real window:

- Header holds without overflow in wide down to 760; rail header is three tidy rows;
  logo slot renders nothing gracefully; signed-out `Sign in` visible in both.
- Search results, empty-results, empty-Library, populated Library, Collections list,
  open Collection, open Collection with the Credits/manifest panel, and a Sound mid-play
  — each renders without horizontal overflow in rail.
- A row `⋯` menu opens, is keyboard-navigable, closes on Escape / outside-click / after
  an action; "Add to collection" opens the nested `CollectionMenu`.
- Drag-out works from a rail row.
- Transport is one row in rail; Loop / Auto-advance / Volume reachable from its `⋯`;
  scrub waveform still clickable; Support heart visible.
- `?` key still opens the shortcuts dialog with the visible button moved into the menu.
- Resizing across 760 flips the layout live in both directions.
- Edit view unchanged.

### What cannot be tested automatically

The entire visual/interaction surface of this feature. The pure helper proves only that
the breakpoint decision is correct; a person proves the layouts actually hold at width.

## Out of Scope

- **Any change to the Edit view.** It stays full-bleed and is not driven by the
  breakpoint.
- **A `brand/logo.svg` asset.** The slot is wired; the artwork lands separately.
- **Per-user or persisted layout preference.** The layout is a pure function of window
  width; there is no "force wide" / "force rail" toggle.
- **A third (medium/tablet) tier.** One breakpoint only.
- **Container queries or per-pane responsiveness.** The decision is the window width,
  read once.
- **Headless-browser or Playwright layout tests, or introducing jsdom component tests.**
  The project's no-renderer-component-tests convention stands.
- **Reworking `CollectionMenu` or `FilterPopover`.** Only the new `OverflowMenu` is added.
- **Vertical / short-window responsiveness.** `MIN_WINDOW_HEIGHT` is unchanged and no
  height breakpoint is introduced; the concern is width.
- **Touch / pointer-coarse affordances.** This is a docked desktop window, mouse and
  keyboard.
- **Changing which Sounds are draggable, how Originals are Staged/evicted, or any search
  behaviour.**

## Further Notes

- ADR-0006 records the breakpoint value, the `useViewport`-over-CSS decision, the single
  breakpoint decision, the `MIN_WINDOW_WIDTH` drop, and the "not every action is visible;
  `⋯` is the overflow" principle, with rejected alternatives.
- The minimalism pass (fixed licence slot, tag-authoring relocation, dropped helper
  sentences, "Credits") is folded into ADR-0006 as consequences rather than a separate
  ADR — it is the same principle applied, not a second decision.
- Suggested ticket split for `/to-tickets`:
  1. **`useViewport` + `layoutForWidth` + `MIN_WINDOW_WIDTH` 360** — the seam, the hook,
     the constant, and the `shell-polish` boundary-test update. No visible change yet.
  2. **`OverflowMenu` primitive** — portal menu + keyboard behaviour, used nowhere yet.
  3. **Result row: licence slot + visible-action pare-back + tag authoring into `⋯`** —
     wide layout only, both the alignment fix and the button/tag minimalism.
  4. **Rail result row** — the two-line variant behind `isRail`.
  5. **Rail + hardened header** — logo slot, header `⋯`, wide truncation/abbreviation,
     rail three-row structure, result-count relocation.
  6. **Rail transport bar + FilterBar + sub-bar pare-back + "Credits" rename.**
  Tickets 3 and 6 carry user-visible change in the wide layout and want a manual pass;
  1 carries the only automated tests.
- `useViewport` should guard against `matchMedia` firing during teardown and should read
  an initial value synchronously so the first paint is already in the right layout (no
  wide→rail flash), mirroring how `uiReady` / `prefsReady` gate first paint in `App.tsx`.
