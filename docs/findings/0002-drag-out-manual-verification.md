# 0002 — Real drag-out: manual verification (ticket 09)

**Status:** automated verification complete; manual GUI drag-out verified by the user on
macOS (2026-08-30) — drag into a DAW delivers the native-quality Original under the
Sound's name. Windows (§B) still outstanding.
**Date:** 2026-08-30
**Depends on:** [0001 — drag-out spike](0001-drag-out-spike.md) (its §3 checklist is the
prerequisite; run it first if it has not been run).

Ticket 09 wires the spike's proven mechanism into the product: `DragHost` wraps the
single `webContents.startDrag` call, and on `dragstart` the staged Original is hardlinked
into `<userData>/drag/` under a sanitised, human-readable name — that path is what the OS
receives. A Preview is never handed over; an unstaged Sound refuses the drag with a
visible message.

---

## 1. Verified automatically (`apps/desktop`, `test/drag.test.ts`, 9 tests)

At the core seam, with a recording `DragHost` in place of Electron:

- the path handed to `DragHost` has a **human-readable basename derived from the Sound**
  (`Rain_Heavy_Loop.wav`), never the content-store name (`321967.wav`);
- it is a **hardlink** to the content-store Original — same inode, link count ≥ 2 — not a
  copy and not the store path;
- it carries the **Original's bytes**, and the path is never an `http(s)` URL or a
  preview path;
- the dropped file **still resolves after the staged Original is evicted** (the content
  file + `staged_entries` row are deleted and the hardlink still reads back the full
  bytes);
- a drag requested **before the Original is on disk** throws `OriginalNotStagedError`
  (message names the Sound and states a Preview is never dragged), hands nothing to the
  OS, and creates no `drag/` directory — never a silent no-op, never a Preview;
- two Sounds whose names **sanitise to the same basename** arrive as `Ocean waves.wav`
  and `Ocean waves (2).wav`, each hardlinked to its own Original;
- re-dragging the same Sound **reuses the same hardlink** (idempotent);
- **multi-Sound drag is gated**: with `multiFileDragSupported: true` every Sound is
  linked and passed in `files:`; with `false` only the first Sound is dragged and
  `getDragCapabilities().multiSound` is `false`. The production `DragHost`
  (`src/main/dragHost.ts`) sets this to `process.platform === 'darwin'` — Windows
  Explorer drops all but one file (electron#9019, spike §2.2 / §C).

`tsc --noEmit` clean; `electron-vite build` clean; full suite 94 tests green.

## 2. Known limitations / decisions

- **Drag icon.** The renderer rasterises the Sound's own waveform PNG
  (`sound.waveformUrls.m`) to a canvas and hands the core a data URL; the core writes it
  to `<userData>/drag/.icons/` and passes that path. If the CDN image taints the canvas
  (no permissive CORS header) the core falls back to the bundled waveform glyph
  `apps/desktop/resources/drag-icon.png` (regenerate with
  `node scripts/make-drag-icon.mjs`). The icon is therefore **never empty**; whether it
  is the *Sound's* waveform depends on Freesound's CORS headers — confirm visually in E1
  below.
- **Multi-Sound drag is not yet surfaced in the UI** — the result list has a
  single-row selection model (multi-select arrives with ticket 13). The core path and
  the platform gate exist and are tested; there is nothing to click yet.
- **`drag/` cleanup.** Hardlinks in `<userData>/drag/` are left in place (they cost no
  disk space and must outlive an in-flight drop — spike §1.4). A sweep of stale entries
  is deferred to ticket 18.
- **Packaging.** `src/main/index.ts` resolves the fallback icon from
  `resources/drag-icon.png` in the `out/` layout and from `process.resourcesPath` in a
  packaged build; wiring it into `electron-builder` `extraResources` is ticket 19.

---

## 3. MANUAL VERIFICATION CHECKLIST (user must run)

Build/run the real app (`pnpm --filter @freesound/desktop dev`), sign in, grant the
staging consent, run a search, press play on a result and wait for its row to show
**ready**, then drag the row into each target. Record PASS / FAIL / NOTES.

### §A — macOS

| # | Target | Expected | Result |
|---|---|---|---|
| A1 | **Logic Pro** — drag onto an audio track | region lands at native quality (not 128kbps, not `<id>.wav`); the region name is the Sound's name | |
| A2 | **Audacity** — drag onto the project | imports as a full-length track at the Original's sample rate / bit depth | |
| A3 | **Final Cut Pro** — drag into the browser, then the timeline | clip appears, media managed by FCP, plays at native quality | |
| A4 | **Ableton Live** — drag into a Session/Arrangement slot | sample drops in, correct length, plays | |
| A5 | **Finder** — drag onto a window / the Desktop | a normal complete file named after the Sound (e.g. `Rain_Heavy_Loop.wav`); `file` reports the Original's format | |
| A6 | Finder | `shasum -a 256` of the dropped file matches `<userData>/content/<id>.<ext>` | |
| A7 | Any target, then **quit the app and evict** (audition enough other sounds to push this one out, or delete `content/<id>.<ext>`) | the file dropped in A1–A5 still opens and plays | |

### §B — Windows

| # | Target | Expected | Result |
|---|---|---|---|
| B1 | Logic Pro | N/A (macOS only) | N/A |
| B2 | **Audacity** — drag onto the project | imports full length, correct rate | |
| B3 | Final Cut Pro | N/A (macOS only) | N/A |
| B4 | **Ableton Live** — drag into a slot | sample drops in and plays | |
| B5 | **File Explorer** — drag into a folder | one normal complete file, named after the Sound, size matches the Original | |
| B6 | Explorer | `certutil -hashfile <dropped> SHA256` matches `content\<id>.<ext>` | |
| B7 | quit + evict, as A7 | dropped file still opens | |

### §C — Refusal path (both platforms)

| # | Action | Expected | Result |
|---|---|---|---|
| C1 | Drag a row **before** pressing play (status not `ready`) | no OS drag starts; the row shows "Still preparing this sound…"; nothing lands in the target | |
| C2 | Drag a row whose staging shows **unavailable** (permanent download failure) | no OS drag; the row shows the "could not be downloaded" message | |
| C3 | Confirm a Preview is never delivered: inspect any file dropped in §A/§B — it is the Original format (e.g. WAV/FLAC/AIFF), never an `.mp3` preview | | |

### §D — Drag icon

| # | Check | Expected | Result |
|---|---|---|---|
| D1 | While dragging, watch the cursor | a small waveform image follows it; it is recognisably **this Sound's** waveform (if it is instead a generic green waveform glyph, the CDN did not allow the canvas read — note it) | |
| D2 | Drag several different Sounds | the icon is never blank/absent | |

### §E — Multi-Sound drag

Not applicable yet — no multi-select in the UI (ticket 13). When it lands, verify on
Windows Explorer specifically that every file is delivered before the affordance is shown
there (spike §C3).

---

## 4. GO / NO-GO

**Automated: GO.** Every core-seam assertion the ticket lists passes.

**Manual: PENDING.** The milestone ("a sound designer drags a result straight into Logic")
is only proven once §A is green on real hardware. If A1 (Logic) or A2/A4 (Audacity /
Ableton) deliver a transcoded or wrongly-named file, treat it as a release blocker and
re-open ticket 09.
