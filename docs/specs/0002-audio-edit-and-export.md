# Spec 0002 — Audio Edit and Export

Status: ready-for-agent
Vocabulary: see [CONTEXT.md](../../CONTEXT.md). Terms defined there — Sound, Preview,
Original, Staged, Library, Collection, Account, License, Attribution Manifest, Drag-Out —
are used with their glossary meanings. This spec adds one term, **Edit**, defined in
[ADR-0005](../adr/0005-an-edit-is-a-derived-local-sound.md); CONTEXT.md should gain an
entry for it during implementation.
Constraints: see [ADR-0002](../adr/0002-database-is-the-truth.md),
[ADR-0003](../adr/0003-auditioning-stages-a-download.md),
[ADR-0005](../adr/0005-an-edit-is-a-derived-local-sound.md).

## Problem Statement

I find a Sound that is almost right. It has half a second of silence before the hit, or a
stray thump at the tail, or it is a 90-second ambience when I need the middle eight
seconds. Or it is a 24-bit 96 kHz WAV and the thing I am scoring needs a small MP3.

Today my only move is to drag the whole Original into my DAW or a separate audio editor,
trim or convert it there, and export it back out. That means leaving the tool that is
managing my Sounds and their Licenses, doing the fiddly bit somewhere else, and then
having a loose file whose connection to its author and License I now have to remember by
hand. The small fix costs me my flow and quietly breaks the one thing this app is for —
keeping a Sound tied to what it owes.

## Solution

An **Edit** view, opened from a Library Sound. It fills the window and shows the Original's
full-height waveform, with a close control at the top right.

In the view I can click-drag across the waveform to mark a region, loop-audition just that
region to check the in and out points, and adjust the edges. When it is right I **export**.
The export dialog lets me keep the whole file or trim to the marked region, and choose an
output format (WAV, MP3, FLAC, OGG) with optional sample rate, channel (mono/stereo) and
loudness-normalise settings.

The export appears in my Library immediately as its own item, named `edited` (then
`edited (2)`, `edited (3)`, …), which I can rename like any Library Sound. It plays, it
filters, it goes into Collections, and it drags out of the window into a DAW exactly like a
downloaded Original — at the format and quality I chose, under its human-readable name. It
carries the original Sound's License, author and Freesound URL into the Attribution
Manifest, marked as edited. Producing it writes a real file to disk and never spends
anything against my Freesound download quota, because nothing is fetched from Freesound.

## User Stories

1. As a sound designer, I want to open an Edit view from a Library Sound, so that I can fix a small problem with it without leaving the app.
2. As a sound designer, I want the Edit view to fill the window with the Sound's full waveform, so that I can see detail that the row-height waveform hides.
3. As a sound designer, I want a clear close control at the top right of the Edit view, so that I can back out without committing anything.
4. As a sound designer, I want to close the Edit view with the Escape key, so that dismissing it is as fast as opening it.
5. As a sound designer, I want the Edit view to open only for a Sound whose Original is already on disk, so that I am never editing something that is not really there.
6. As a sound designer, I want to be told to download the Original first if I try to edit a Sound that has not been downloaded, so that the requirement is obvious rather than a dead button.
7. As a sound designer, I want the waveform in the Edit view to be the sharp computed-peaks rendering, so that I can place cut points precisely.
8. As a sound designer, I want to zoom the waveform with the scroll wheel and reset zoom with a double-click, so that I can work at the sample region I care about — reusing the interaction I already know from the row waveform.
9. As a sound designer, I want to click-drag across the waveform to mark a region, so that I can define what to keep.
10. As a sound designer, I want the marked region shown as a highlighted band with the rest dimmed, so that I can see exactly what will survive the trim.
11. As a sound designer, I want to drag either edge of the marked region to adjust it, so that I can fine-tune the in and out points.
12. As a sound designer, I want to see the start time, end time and resulting duration of the marked region, so that I know what length I am about to produce.
13. As a sound designer, I want to clear the marked region, so that I can start the selection over or export the whole file.
14. As a sound designer, I want to audition the marked region on a loop, so that I can hear whether the cut points are clean.
15. As a sound designer, I want region audition to play the Original file directly rather than the Preview, so that what I hear is what I will export.
16. As a sound designer, I want a play/stop control for the region audition that is separate from the main transport, so that editing does not disturb what is loaded in the row list.
17. As a sound designer, I want an Export action in the Edit view, so that I can turn my work into a file.
18. As a sound designer, I want the Export dialog to let me keep the whole file instead of trimming, so that I can use the view purely as a converter.
19. As a sound designer, I want to choose the output format — WAV, MP3, FLAC or OGG — so that the file suits where it is going.
20. As a sound designer, I want to set the output sample rate, so that I can down-convert a 96 kHz field recording to 48 kHz for a video edit.
21. As a sound designer, I want to force the output to mono or keep it stereo, so that a one-shot does not waste two channels.
22. As a sound designer, I want an optional loudness-normalise on export, so that a quiet Sound comes out at a usable level.
23. As a sound designer, I want a sensible default name of `edited` for the export, so that I do not have to think of one every time.
24. As a sound designer, I want a second Edit of the same Sound to be named `edited (2)`, and a third `edited (3)`, so that they do not collide.
25. As a sound designer, I want to type my own name for the export in the dialog, so that I can label it meaningfully up front.
26. As a sound designer, I want to see progress while a long file is being exported, so that I know the app has not stalled.
27. As a sound designer, I want to cancel an export in progress, so that a mistake does not force me to wait it out.
28. As a sound designer, I want the finished Edit to appear in my Library right away, so that I can use it without a refresh.
29. As a sound designer, I want the Edit to show in the Library with its own duration, format, sample rate and channel count, so that the list tells the truth about the file.
30. As a sound designer, I want to filter the Library by format and find my exported MP3s, so that the Edit behaves like any other Library item.
31. As a sound designer, I want to rename an Edit after the fact, so that `edited` can become something I will recognise later.
32. As a sound designer, I want to add my own tags to an Edit, so that it is findable the same way my other Sounds are.
33. As a sound designer, I want to add an Edit to a Collection, so that it can ship alongside the other Sounds for a project.
34. As a sound designer, I want to audition an Edit from the row list, so that I can check it in context with everything else.
35. As a sound designer, I want to drag an Edit out of the window into my DAW, so that the whole point of the app still works for a file I made.
36. As a sound designer, I want the dragged-out Edit to arrive under its name, not a numeric id, so that it is identifiable in my session.
37. As a sound designer, I want the dragged-out Edit to be the format and quality I chose, so that there is no silent quality surprise.
38. As a sound designer, I want an Edit in a Collection to appear in that Collection's Attribution Manifest, so that I do not under-credit work I actually used.
39. As a sound designer, I want the Manifest entry for an Edit to credit the original author, License and Freesound URL, so that the credit is correct even though the file is mine.
40. As a sound designer, I want the Manifest to mark an Edit as edited, so that a reader knows the credited material was modified.
41. As a sound designer, I want an Edit of a non-commercial Sound to be flagged and listed apart in the Manifest exactly like its parent, so that trimming does not launder a license restriction.
42. As a sound designer, I want producing an Edit to cost nothing against my Freesound download quota, so that editing is free to do as often as I like.
43. As a sound designer, I want my Edits to survive a Library rebuild from sidecars, so that a lost database does not lose the files I made.
44. As a sound designer, I want an Edit to remain fully credited after I delete its parent Sound from the Library, so that housekeeping does not strip attribution.
45. As a sound designer, I want deleting an Edit to remove its file and reclaim the disk, so that abandoned exports do not pile up invisibly.
46. As a sound designer, I want deleting an Edit to leave the parent Sound and its Original untouched, so that removing a derivative is safe.
47. As a sound designer, I want to reveal an Edit's file in Finder/Explorer, so that I can grab it outside a drag if I need to.
48. As a sound designer, I want "open on freesound.org" on an Edit to open the original Sound's page, so that the source is one click away.
49. As a sound designer, I want a clear error if the Original cannot be decoded or the export fails, so that I am not left wondering whether it worked.
50. As a sound designer, I want an Edit whose parent is a compressed format to still get a waveform in the Edit view, so that I can place cut points regardless of source format.
51. As a sound designer, I want exporting the whole file with no format change to still be allowed, so that I can produce a plain copy under a chosen name if that is what I want.
52. As a sound designer, I want the marked region to persist while I open and adjust the Export dialog, so that opening the dialog does not lose my work.

## Implementation Decisions

### Domain

- New concept **Edit**, per ADR-0005: a derived local Sound with a negative `id` in the
  `sounds` table, inheriting its parent Sound's License, author and Freesound URL. Add an
  entry to CONTEXT.md.
- An Edit is **immutable** once created. Changing a trim or format means creating another
  Edit and deleting the first. There is no re-edit of an existing Edit's spec.
- The Edit view is reachable in v1 only from a Freesound-backed Library Sound, so an Edit's
  parent is always a real Sound and edit chains do not arise.

### Schema

- New migration (next id, append-only). Add to `sounds`: `derived_from INTEGER` (parent
  Sound id; null for real Sounds), `edit_spec TEXT` (JSON; null for real Sounds),
  `local_path TEXT` (absolute path to the Edit's file; null for real Sounds).
- `library_entries` is written for an Edit at creation time — an Edit is born in the
  Library, it is never Staged.
- The `peaks` row for an Edit is keyed by its negative id, unchanged in shape.
- Sidecar schema version bumps. An Edit's sidecar carries `derivedFrom` and `editSpec` in
  addition to the existing fields; the `sound` block holds the Edit's own metadata with the
  inherited License / author / URL.

### Edit spec

The shape persisted in `edit_spec` and passed to `createEdit` (from the design
discussion, not a prototype):

```
{
  trim: { startSec: number, endSec: number } | null,   // null = whole file
  format: 'wav' | 'mp3' | 'flac' | 'ogg',
  sampleRate?: number,          // omit = keep source rate
  channels?: 1 | 2,             // omit = keep source channels
  normalize?: boolean           // omit / false = no loudness normalise
}
```

### Core command API

- `createEdit(parentSoundId, spec): Promise<{ editId: number }>` — resolves once the Edit
  is a complete Library item (file + sidecar on disk, `sounds` row, `library_entries` row,
  peak computation kicked off). Render progress (0–1) and terminal failure are pushed on a
  new `onEditProgress` listener, mirroring `onStagingStatus` / `onPeaks`. Silent no-op if
  the parent is unknown or its Original is not on disk. Never calls the gateway.
- `cancelEdit(parentSoundId)` — abort an in-flight render; nothing is written.
- Edits surface through the existing commands with no new list method:
  `listLibrary` / `filterLibrary` / `getLibraryFilter` include Edits; `filterLibrary`
  matches an Edit on its own duration / format / tags. `deleteFromLibrary` on a negative id
  drops the row and deletes the Edit's file (not the parent's). `setCustomName` /
  `setLibraryTags` / `addToCollection` / `removeFromCollection` / `revealInFinder` accept a
  negative id. `openFreesoundPage` on an Edit opens the parent's URL. `startDrag` accepts a
  negative id. `generateManifest` includes Edits. `rebuildFromSidecars` reconstructs them.
  `requestPeaks` / `getPeaks` accept a negative id.
- `LibrarySound` gains `derivedFrom: number | null` and `editSpec: EditSpec | null`.
  `effectiveName` for an unrenamed Edit is `edited` / `edited (N)`.
- Name disambiguation is a pure helper: given a parent id and the existing Edit names for
  that parent, return the next free `edited` / `edited (N)`.

### Render seam

- `audioRenderRunner` is injected into `createCore` exactly like `computePeaksRunner` and
  `rebuildRunner`. Signature roughly
  `(input: { sourcePath, spec, outPath, signal }) => Promise<{ byteSize: number, durationSec: number }>`,
  reporting progress via a callback.
- The production runner lives in `src/main`, spawns the bundled `ffmpeg-static` binary,
  builds the arg list from the spec (one invocation does trim + encode + resample +
  downmix + normalise), parses stderr for progress, and honours the abort signal. It also
  stamps title / author / License URL into the output file's metadata tags.
- The core stays Electron-free and binary-free; it only ever sees the injected runner
  (enforced by the existing no-electron test).

### Content store and Drag-Out

- Path resolution gains an Edit case: an Edit's file is `<parentId>-edited[-N].<ext>` in
  the content store, taken from `local_path`, not derived from the (negative) id.
- Drag-Out for an Edit hardlinks `local_path` into the temp directory under the Edit's
  `effectiveName` and hands that path to `DragHost` — same ADR-0002 rule as an Original,
  minus the id-to-name step because the Edit already has a name. A drag requested before
  the render finishes is refused, exactly like an un-Staged Original.

### Peaks

- `requestPeaks` for a negative id computes from the **parent Original**, decoded and
  sliced to `[startSec, endSec]`, when the parent is WAV / AIFF. When it is not, the render
  step additionally emits a scratch PCM file that the peak Worker consumes; the scratch
  file is discarded afterwards. Either way the peaks row is keyed by the negative id.

### Attribution Manifest

- `buildManifest` treats an Edit entry as its parent for author, License name and Freesound
  URL, and appends an "edited" marker to the title line. The `requiresAttribution` /
  `restrictsCommercialUse` predicates run on the inherited License, so an Edit sits in the
  same section (credit-required vs CC0) and the same non-commercial flag/segregation as its
  parent. The Manifest remains a snapshot.

### Rebuild from sidecars

- A sidecar carrying `derivedFrom` reconstructs a derived `sounds` row plus a
  `library_entries` row; the negative id is re-minted locally (ids are not stable across a
  rebuild and nothing external references them). Orphan-audio and orphan-sidecar handling
  is unchanged.

### Renderer

- New full-bleed **Edit view**, added to the shell-view union and persisted shell state.
  Reached from an "Edit" affordance on a Library row and/or the transport bar. Escape and a
  top-right control close it.
- Reuses `drawPeakWaveform` and `zoomWindow`. Pointer-drag paints a region; region edges
  are draggable; a region audition control loops `[startSec, endSec]` via a `timeupdate`
  bound added to `audioController` (playing the local Original, not the Preview).
- Export dialog: trim-to-region toggle, format, sample rate, channels, normalise, name
  field. Confirm calls `createEdit`; progress and cancel are wired to `onEditProgress` /
  `cancelEdit`.
- Pure helpers pulled out for unit test: region ↔ fraction math, `EditSpec` construction
  from dialog state, and the `edited` / `edited (N)` name picker (shared with the core
  helper or duplicated as a pure fn — the core one is authoritative).

## Testing Decisions

### What makes a good test here

A test drives the core command API and asserts on observable outcomes: what a later query
returns, what is on disk, what was handed to `DragHost`, and what was handed to
`audioRenderRunner`. It does not assert on private methods or on schema shape beyond what a
command returns. A test should survive a rewrite of the module it covers and fail only when
a user-visible promise breaks. This is the same bar as spec 0001 § Testing Decisions.

### Where the tests attach

- **Primary seam: the core command API via `makeTestCore`**, with a **fake
  `audioRenderRunner`** injected alongside the existing fake gateway / auth / peak runner.
  Real temp SQLite and real temp filesystem, as for tickets 08 / 11 / 14 / 17.
- The fake `audioRenderRunner` must simulate: a fast successful render (writes deterministic
  bytes or copies a fixture to `outPath`), a slow render that emits progress, an aborted
  render, and a failure (unreadable source / encode error).
- **Pure unit tests** for region math, the `EditSpec` builder and the name picker. Prior
  art: `test/waveform-peaks.test.ts`.
- **No renderer component tests**, per spec 0001. The modal, the drag-to-select feel, the
  loop audition and a real dragged-out Edit landing in a DAW are manual GUI verification.
  Prior art: `docs/findings/0002-drag-out-manual-verification.md`.

### What gets tested at the primary seam

- `createEdit`: renders through the fake runner; writes the Edit's file and sidecar to the
  content store; writes a `sounds` row with a negative id and the parent's License / author
  / URL; writes a `library_entries` row; `getPeaks` for the new id eventually returns
  peaks; a second Edit of the same parent is named `edited (2)`; the gateway is never
  called and `getDownloadsInLast24h` is unchanged; `cancelEdit` mid-render leaves nothing
  behind; a `createEdit` whose parent Original is absent is a no-op.
- Library: `listLibrary` and `filterLibrary` return Edits; a format filter selects an
  exported MP3; `deleteFromLibrary` on the Edit removes its row and its file and leaves the
  parent Sound and its Original in place; `setCustomName` renames the Edit.
- Drag-Out: `startDrag` on an Edit hands `DragHost` a hardlink to the Edit's own file under
  its `effectiveName` basename — not the store path, not a Preview; a drag before the render
  completes is refused.
- Attribution: a Collection containing an Edit produces a Manifest entry crediting the
  parent's author / License / URL with an edited marker; an Edit of a CC-BY-NC Sound is
  flagged and segregated; the Manifest does not change when the Collection changes
  afterwards.
- Recovery: deleting the database and rebuilding reconstructs each Edit from its
  `derivedFrom` sidecar into the Library; an Edit whose parent Sound has been deleted is
  still fully attributed from its own row.

### What cannot be tested automatically

The Edit view modal and its pointer interaction, region loop-audition timing, and a real
Edit dragged into Logic / Audacity / Final Cut / Ableton / the file manager on macOS and
Windows. Same Day-1-gate manual checklist as Drag-Out.

## Out of Scope

- Any DSP beyond trim, loudness-normalise, and format / sample-rate / channel conversion —
  no fades, gain envelopes, EQ, denoise, or multi-region assembly.
- Re-editing an existing Edit's spec. An Edit is immutable; make another and delete the
  first.
- Opening the Edit view on an Edit (editing an Edit). v1 reaches the view only from a
  Freesound-backed Library Sound.
- Batch export, e.g. a whole Collection to MP3 in one action.
- A spectrogram view inside the Edit view.
- `ffmpeg-static` packaging, asar-unpacking and macOS signing — that is ticket 19.
- Any change to how Originals are downloaded, Staged, evicted or auditioned.

## Further Notes

- ADR-0005 records the derived-Sound model and the rejected alternatives (separate table;
  in-place edit; lazy render at drag time).
- Depends on ticket 11 (Library) and ticket 12 (computed peaks), both done. The packaging
  half sequences after ticket 19, but the core and renderer work do not block on it —
  development uses `ffmpeg-static` from `node_modules`.
- The `audioRenderRunner` seam is deliberately the same shape as `computePeaksRunner` and
  `rebuildRunner`. Inlining an ffmpeg spawn into the core would pull a binary dependency
  into the Electron-free core and dissolve the single test seam — spec 0001 § "Things that
  will be tempting and are wrong".
- Suggested ticket split: **20 — Edit domain + `createEdit` + render seam + Library /
  Drag-Out / Manifest / rebuild integration** (all core-tested), then **21 — the Edit view
  UI**.
