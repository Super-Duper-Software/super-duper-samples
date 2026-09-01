# A thin "rail" layout for docked use

A user working alongside a DAW will dock this window to one side of the screen to keep
it out of the way. The single fluid layout the shell has today survives that only on
paper: the `main/index.ts` comment claims it "holds together down to
`MIN_WINDOW_WIDTH`", but the header, `TransportBar` and `FilterBar` all rely on
`flex-wrap` and by ~900px the header's right-hand cluster (result count, download
quota, "Signed in as …", `?`) has wrapped into a ragged second row, and result rows —
with a fixed `w-28` waveform, a four-button action cluster and a variable-width
trailing licence chip — overflow well before the 640 floor.

We add a **second layout, "rail"**, for narrow widths, and take the whole shell
minimal in both.

## The breakpoint

A single flip at **`max-width: 760px`**. At or below it the shell is "rail"; above it,
"wide". 760 is chosen so that a half-width dock on a 1080p-or-smaller display — where
this actually bites — lands in rail, while a half-width dock on a 1440p+ display stays
wide with room to spare. There is no intermediate tier: "wide" is merely hardened
(truncation, abbreviation) to hold cleanly down to the breakpoint, and "rail" is a
genuinely different arrangement, not the wide layout with smaller gaps.

`MIN_WINDOW_WIDTH` drops from 640 to **360** (`src/core/uiState.ts`). 360 is the width
the rail layout is designed against; `MIN_WINDOW_HEIGHT` is unchanged at 480.

## How the breakpoint is read

A `useViewport()` hook exposes `isRail: boolean` from a single
`matchMedia('(max-width: 760px)')` listener held in one place. Components branch in JS
— `isRail ? <RailX/> : <WideX/>` — rather than rendering both trees and toggling
`display` in CSS.

Chosen over Tailwind's own `max-*` media-query variants because the two layouts differ
structurally, not just in spacing: the tab bar becomes a full-width segmented control,
row action clusters collapse to a menu, the transport's controls move off the bar. That
kind of divergence is awkward to express as pure CSS and clean to express as a branch,
and the codebase already reaches for hooks and stores over CSS cleverness. Tailwind
responsive utilities are still used for incidental padding/size tweaks that do not need
a branch.

## The `⋯` overflow menu

A new `OverflowMenu` primitive — portal-based `role="menu"`, keyboarded, closes on
Esc / outside-click / after an item runs — modelled on the existing
`CollectionMenu.tsx` portal pattern. It is the single mechanism by which any bar or row
sheds actions it cannot show. `CollectionMenu` and `FilterPopover` are unchanged;
"Add to collection" inside an `OverflowMenu` opens `CollectionMenu` as a nested step.

## Consequences

**Not every action is visible at all times, in either layout.** This is a deliberate
shift. The `⋯` menu is the overflow, and "is this action important enough to occupy the
row / bar, or does it live in `⋯`?" is now a question every affordance answers. Applied:

- **Result rows.** Wide search rows show only the `Download` / `✓ Downloaded` button;
  `Page` and `Add to collection` move to `⋯`. Wide Library rows show only `✂ Edit`;
  `Rename`, `Reveal`, `Page`, `Add to collection` and the destructive `Remove` move to
  `⋯`. Wide Collection rows additionally keep `Remove from collection` visible (it is
  frequent and non-destructive there). Rail rows are two lines — play · name · `⋯`
  above, small waveform · duration · type · one state token · custom-tag chips below —
  with everything else in `⋯`; the multi-select checkbox folds into `⋯` as "Select".

- **The trailing licence area is one fixed-width slot** (`~w-24`, right-aligned, always
  rendered) holding *either* the `⚠ Non-commercial` pill *or* the `LicenseChip`, never
  both — so the action column to its left aligns row to row. The brand rule in
  `LicenseChip.tsx` (differ by label + shape, never hue alone; NC gets a heavier
  border) still holds: NC keeps its own pill, it just occupies the shared slot.

- **Tag authoring leaves the row.** Library / Collection rows show the user's custom-tag
  chips read-only; adding and removing tags moves to `⋯` → "Edit tags" (and the Edit
  view). Freesound's own tag list is off the row entirely — tooltip and Edit view only.

- **Helper sentences are dropped** from the Library and Collections sub-bars in both
  layouts (the "· select a row and press Delete …" and "· removing a sound here keeps
  it in your Library" lines). The affordances they described are reachable via row `⋯`
  and the shortcuts dialog.

- **`TransportBar`.** Rail: one row — play/pause · current-sound name · `♥` (glyph
  only) · `⋯` holding Stop, Loop, Auto-advance and the volume slider. The scrub
  waveform stays, at `h-12`. The `w-28` status-label column becomes a colour/spinner
  cue on the play button. `♥ Support` stays visible in rail by explicit choice.

- **Header.** The `<h1>` wordmark is replaced by a small logo slot
  (`<img src="brand/logo.svg">`, silently empty until the asset lands). A header `⋯`
  now exists in *both* layouts, holding Sign out, Keyboard shortcuts and View logs;
  `Sign out` is no longer inline. Wide: `AuthBar` truncates the username and drops
  "Signed in as" below ~820px; `DownloadQuota` abbreviates to "N ↓" below ~900px (full
  text in `title`). Rail: utility row is logo · quota · `⋯`; tabs get their own
  full-width segmented row; the live result count moves out of the header into the top
  of the list body.

**The Edit view is exempt.** It stays exactly as it is — a "full-screen the app to work
on it" experience, not something to use docked.

**`CONTEXT.md`** gains one line: the user-facing control that generates an Attribution
Manifest is now labelled **"Credits"**; the artifact and the term in code and docs stay
"Attribution Manifest".

Verification is jsdom structural tests (a `useViewport` unit test with mocked
`matchMedia`; component tests forcing `isRail` and asserting what renders where) plus a
manual pass at the 360 floor. No headless-Chrome layout assertion is added.

Rejected: **pure CSS / Tailwind media queries.** Fine for spacing, poor for the
structural divergence the two layouts actually have; would mean shipping both trees and
toggling `display`.

Rejected: **a multi-tier breakpoint set** (e.g. wide / medium / rail). The 760–960
"medium" band is handled well enough by hardening the wide layout; a third arrangement
is more surface area than the problem needs.

Rejected: **hardening the existing single layout only, no rail.** It cannot reach 360 —
the fixed waveform, the action cluster and the transport controls do not fit at that
width no matter how they are compressed. A docked user needs a different arrangement,
not a tighter one.

Rejected: **lowering `MIN_WINDOW_WIDTH` below 360.** Below that the two-line rail row
and the segmented tab bar stop working too; 360 is the designed floor.
