# 0001 — Drag-out platform spike (ticket 01)

**Status:** programmatic verification complete; manual GUI verification pending (user).
**Date:** 2026-08-29
**Spike code:** `spike/drag-out/` (throwaway — discard after this doc is accepted).
**Gates:** the whole backlog. See [ADR-0001](../adr/0001-electron-over-tauri.md).

The deliverable of this ticket is knowledge, not code. This document records what a
machine could confirm, what Electron documents, and the manual checklist a human must
run on real hardware before ticket 09 starts.

---

## 1. What was verified programmatically (with results)

Environment: macOS 14 (Darwin 24.6.0), Node 24.6.0, Electron 32.3.3, pnpm 10.15.1.

### 1.1 App boots without crashing

`SPIKE_SMOKE=1 electron .` creates the `BrowserWindow`, loads `index.html`, and exits 0.

```
[smoke] window created, no startup crash — exiting 0
electron exit=0
```

`node --check` passes on `main.js`, `preload.js`, `renderer.js`, `generate-wav.mjs`.
`pnpm --filter @freesound/spike-drag-out start` is wired (`"start": "electron ."`).

**Result: PASS.** The Electron shell launches and the IPC/preload wiring loads.

### 1.2 WAV validity

`node generate-wav.mjs` writes `asset/sample.wav` and re-parses its header:

```
riff: 'RIFF'   wave: 'WAVE'   fmtId: 'fmt '
audioFormat: 1 (PCM)   channels: 2   sampleRate: 44100   bits: 16
dataId: 'data'   parsedDataSize: 529200
fileBytes: 529244   expectedBytes: 529244   durationSeconds: 3
WAV header valid: OK
```

`file(1)` independently agrees:
`RIFF (little-endian) data, WAVE audio, Microsoft PCM, 16 bit, stereo 44100 Hz`.

Header math checks out: `44 + frames*blockAlign = 44 + 132300*4 = 529244` = actual file
size. Left channel 440Hz, right 660Hz, 8ms linear fades to avoid click artifacts.

**Result: PASS.** The dragged file is a real, valid, self-contained PCM WAV.

### 1.3 Hardlink round-trip (the ticket-09 path)

Script: link `asset/sample.wav` into a temp dir as `My Dragged Sound.wav`, then delete
the original and read the link back.

```
same inode: true      nlink: 2
link readable after src rm: true
byte length match: true   (529244)
sha256 match: true    1aa289acc002d4f794c3fe528287b60094c0e2739d3c2d5acb11538f39024461
```

- `fs.linkSync(src, linkPath)` succeeds within `os.tmpdir()` (same APFS volume).
- After `fs.rmSync(src)` the hardlink is still fully readable and byte-identical
  (SHA-256 match), because on a hardlink the two directory entries point at the same
  inode; removing one only decrements the link count. The bytes live until the *last*
  link is gone.
- The spike falls back to `fs.copyFileSync` if `linkSync` throws `EXDEV`
  (cross-device) — relevant only if ticket 09 ever links across volumes, which it must
  not.

**Result: PASS.** Hardlink creation + source-deletion + identical-bytes readback all
hold. Ticket 09 can safely drag a human-named hardlink instead of the library file.

### 1.4 Source-deletion-after-drop reasoning

Directly testable only with a real GUI drop, so this is reasoning plus what the OS
guarantees; the checklist below confirms it empirically.

- `webContents.startDrag()` hands the OS a **file path**, not a file handle. On both
  macOS (`NSFilePromiseProvider` / pasteboard file URL) and Windows
  (`IDataObject` / `CF_HDROP`), the receiving application is responsible for reading
  that path during the drop.
- Well-behaved importers (Logic, Audacity, Final Cut, Ableton, Finder/Explorer copy)
  **read the bytes at drop time** and produce their own copy or media reference.
  Deleting the source *after* the drop completes is therefore safe for them.
- Deleting the source *before or during* the drop is a race and will fail the import.
- The spike's "delete source 3s after dragstart" checkbox is deliberately hostile: 3s
  is usually long enough for a human to complete the drop, so a correctly-copying
  receiver keeps working and a lazy-referencing one breaks. This is the discriminator
  the manual checklist uses.
- Implication for the real app: **never delete/evict a Staged Original while a drag
  that references it might still be in flight.** A short grace period after `dragend`
  (or drop) before eviction is the safe design. Hardlink-drag (1.3) makes this cheap:
  drag a private hardlink, and evicting the library copy cannot pull bytes out from
  under an in-progress drop as long as the hardlink survives until `dragend`.

**Result: REASONED PASS, pending checklist item 4.**

### 1.5 Multi-file staging

`main.js` stages a second real file (`os.tmpdir()/freesound-spike-sample-2.wav`, a
copy of the wav) so "drag multi" passes a genuine 2-element `files:` array to
`startDrag`. No programmatic assertion of drop behaviour is possible (see §2.2).

---

## 2. Electron's documented behaviour

Source: Electron `webContents.startDrag(item)` docs and the tracking issues cited.

### 2.1 Single-file drag — `startDrag({ file, icon })`

First-party API, present since Electron 1.x, still current. `file` is an absolute path
string; `icon` is a `nativeImage` (or a path). Called from the main process, normally
from an `ipcMain` handler triggered by the renderer's `dragstart` after
`event.preventDefault()`. This is the supported, shipping-app path (the ADR's whole
premise). **Expected: works on macOS and Windows for all target apps.**

### 2.2 Multi-file drag — `startDrag({ files: [...], icon })`

`files` (plural) is the documented multi-path form; when present it takes precedence
over `file`.

- **macOS:** delivers the whole array. Multi-file drag-out works.
- **Windows:** **broken** —
  [electron#9019](https://github.com/electron/electron/issues/9019): dragging an array
  of paths into Windows Explorer yields **only one file**. Long-standing, not fixed.
  ADR-0001 already calls this out: "an array of paths dropped into Explorer yields one
  file. Single-item drag is the reliable path; multi-select drag must be verified
  per-platform before it is offered in the UI."

**Consequence for ticket 09:** multi-file drag-out must be **gated to macOS only**
unless the user's own Windows testing (checklist §B) shows otherwise. On Windows,
multi-select drag should fall back to single-file or be disabled.

### 2.3 Empty / invalid icon on macOS

The `icon` field is **mandatory and must be non-empty**. On macOS, `startDrag` throws
synchronously if the icon is missing, empty, or an invalid `nativeImage`
("Must specify non-empty 'icon' option"). On Windows an empty icon is more forgiving
but still unsupported. The spike always passes a real 32×32 PNG `nativeImage` and
guards with `icon.isEmpty()` before calling `startDrag`, reporting the error to the
renderer instead of crashing.

**Consequence for ticket 09:** ship a bundled drag icon asset (e.g. a small waveform
glyph) and treat "icon failed to load" as a hard error, not a warning. Never call
`startDrag` with a `nativeImage` that could be empty.

### 2.4 Hardlink drag

Electron/the OS drag the **path** it is given. If that path is a hardlink, the OS
reads the link target's inode bytes at drop time exactly as for any regular file — the
receiver cannot tell it was a hardlink and copies the bytes normally. Confirmed
mechanically in §1.3 (identical SHA-256 after deleting the other link). This is why
ticket 09 can drag a temp-dir hardlink under a pretty filename
(`Rain on tin roof.wav`) instead of the content-store name (`<soundId>.wav`) without
copying the audio.

Caveats for ticket 09:
- Hardlinks only work **within one filesystem**. The temp/staging hardlink dir must
  live on the same volume as the content store. Handle `EXDEV` by copying.
- The hardlink should be cleaned up on `dragend`, but only *after* — see §1.4.
- Windows supports hardlinks on NTFS (`fs.linkSync` works); verify on the user's
  Windows box (checklist §B) since the content store there may span drives.

---

## 3. MANUAL VERIFICATION CHECKLIST (user must run)

The spike cannot drive a real GUI drag into another application, and there is no
Windows machine in this environment. The user must run the spike
(`pnpm --filter @freesound/spike-drag-out start`) and complete every row below on
real hardware. Record PASS / FAIL / NOTES for each.

### §A — macOS

Run the spike on macOS. For each target, select **drag single**, drag the box onto the
target, and confirm the described result.

| # | Target app | Action | Expected result | Result |
|---|---|---|---|---|
| A1 | **Logic Pro** | drag onto an audio track / the tracks area | file lands on a track at native quality (16-bit / 44.1kHz stereo, 3s, not transcoded, not a preview) | |
| A2 | **Audacity** | drag onto the project window | audio imports as a new stereo track, full length, correct sample rate | |
| A3 | **Final Cut Pro** | drag into the browser, then onto the timeline | clip appears in the browser and can be edited onto the timeline; media is copied/managed by FCP | |
| A4 | **Ableton Live** | drag into a Session/Arrangement slot | sample drops in, plays, warp/clip view shows correct length | |
| A5 | **Finder** | drag onto a Finder window / the Desktop | a normal, complete `.wav` file is created; `file sample.wav` reports `WAVE audio, Microsoft PCM, 16 bit, stereo 44100 Hz`; byte size 529244 | |
| A6 | Finder | inspect the dropped file's bytes vs `spike/drag-out/asset/sample.wav` | `shasum -a 256` matches the source exactly | |

### §B — Windows

Run the spike on Windows (build/run Electron there). Repeat the target-app matrix.

| # | Target app | Action | Expected result | Result |
|---|---|---|---|---|
| B1 | **Logic Pro** | N/A on Windows | skip — record "N/A (macOS only)" | N/A |
| B2 | **Audacity** | drag onto the project window | audio imports, full length, correct rate | |
| B3 | **Final Cut Pro** | N/A on Windows | skip — record "N/A (macOS only)" | N/A |
| B4 | **Ableton Live** | drag into a Session/Arrangement slot | sample drops in and plays | |
| B5 | **File Explorer** | drag into a folder window | one normal, complete `.wav`; open in properties → 3s, matches source size 529244 | |
| B6 | Explorer | `certutil -hashfile <dropped.wav> SHA256` vs source | hashes match | |

### §C — Multi-file drag (both platforms, Explorer called out)

Select **drag multi (2 files)**. The array is `[asset/sample.wav, <tmp>/freesound-spike-sample-2.wav]`.

| # | Where | Expected | Result |
|---|---|---|---|
| C1 | macOS Finder | **both** files appear | |
| C2 | macOS Logic/Audacity/Ableton | both files import (or the app's normal multi-import prompt) | |
| C3 | **Windows File Explorer** | **electron#9019 check:** does Explorer receive both files or only one? Record the exact count. Expectation: only one. | |
| C4 | Windows Audacity/Ableton | record how many files import | |

> If C3 shows only one file (expected), ticket 09 must gate multi-select drag to
> macOS. If C3 shows both, note the Electron version and Windows build — that would
> change the plan.

### §D — Delete source after drop

Tick **delete source file 3s after dragstart**. Select **drag single**. Drag into a
target, complete the drop within 3 seconds, then wait.

| # | Where | Expected | Result |
|---|---|---|---|
| D1 | macOS Finder | dropped copy still exists and opens after the source wav is deleted (receiver copied, not referenced) | |
| D2 | Logic / Audacity / Ableton / Final Cut (macOS) | imported audio still plays after source deletion; save & reopen the project to be sure it was copied into the project/media folder, not linked to the now-gone path | |
| D3 | Windows Explorer + one DAW | same: dropped file / imported clip survives source deletion | |
| D4 | Any target, but **complete the drop AFTER the 3s** (source already deleted) | drop fails or imports nothing — confirms the race and that eviction must wait for `dragend` | |

> After D-series tests, re-run `node spike/drag-out/generate-wav.mjs` to restore
> `asset/sample.wav`.

### §E — Drag icon rendering

| # | Check | Expected | Result |
|---|---|---|---|
| E1 | While dragging (any mode), watch the cursor | a small drag image / thumbnail follows the cursor (the 32×32 PNG from `main.js`) | |
| E2 | macOS: temporarily edit `dragIcon()` in `main.js` to `return nativeImage.createEmpty()` and drag | `startDrag` throws / the spike logs `dragstatus {ok:false, error:"...icon is empty..."}`; **revert the edit after** | |
| E3 | Windows: same empty-icon edit | note the behaviour (Windows is more lenient); revert | |

---

## 4. GO / NO-GO recommendation

**Recommendation: GO — contingent on the user completing §3.**

Rationale:

- Electron's `webContents.startDrag` is a **first-party, long-stable API** (since
  Electron 1.x) and is the exact mechanism shipping Electron apps use to drag files
  into DAWs and Finder/Explorer. ADR-0001 chose Electron over Tauri specifically to
  put this feature on a first-party API.
- Everything verifiable without a GUI passed: the app boots, the WAV is valid and
  self-contained, hardlink drag round-trips with identical bytes after source
  deletion, and the source-deletion-after-drop design has a clear safe pattern.
- No blocker was found. The one known defect (multi-file drag on Windows Explorer,
  electron#9019) is already understood and is a **scoping constraint, not a blocker**.

Conditions attached to the GO:

1. The user completes the §3 manual checklist on **both macOS and Windows** against
   the real target apps. GO becomes final only when §A, §B, §C, §D, §E are green
   (modulo the platform-N/A rows).
2. **Multi-file drag-out must be gated to macOS only in ticket 09** unless the user's
   §C3 result on Windows Explorer proves every file is delivered.
3. Ticket 09 must ship a bundled non-empty drag icon and treat a failed/empty icon as
   a hard error (§2.3).
4. Ticket 09's Staged-eviction logic must not delete an Original (or its drag
   hardlink) until after `dragend` (§1.4).
5. Hardlink drag stays on a single filesystem; `EXDEV` falls back to copy (§2.4).

If any §A row (single-file drag into Logic/Audacity/Final Cut/Ableton/Finder on
macOS) fails, escalate to **NO-GO** immediately — that is the feature the product
cannot ship without.
