# 20 — A computed waveform for every Original, and a real error state when there isn't one

**What to build:** Opening the [Edit](../../../CONTEXT.md) view on a Sound whose
[Original](../../../CONTEXT.md) is a compressed container (FLAC, MP3, OGG) shows a
real, zoomable, scrubbable waveform — the same canvas the row list draws for WAV
and AIFF. When peaks genuinely cannot be produced, the Edit view says so and points
the user at a way forward, instead of sitting on "Computing the waveform…" forever.

**Blocked by:** 12 — Computed peaks and canvas waveform.

**Status:** done — see `PROGRESS.md` § "Ticket 20 — what landed"

---

## The bug this fixes

A FLAC opened in the Edit view hangs on **"Computing the waveform…"** indefinitely.
It is not actually computing — the work finished almost immediately with "cannot
decode", and the UI has no state for that outcome.

The chain:

1. **The local decoder only handles WAV and AIFF.**
   `core/peaks/decodeAudio.ts` — `decodeAudioBuffer` throws `UndecodableAudioError`
   for any other container.
2. For a plain Sound, `core/peaks/peakService.ts` — `soundTask` points the peak
   runner straight at the FLAC Original. It fails with
   `{ ok: false, undecodable: true }`.
3. `applyResult` writes the **undecodable sentinel row** (`bucketCount: 0`) and
   emits `status: 'unavailable'`.
4. The renderer's `store/usePeaks.ts` records the entry as `null`.
5. **`renderer/components/EditView.tsx` never distinguishes `null` from
   `undefined`.** Its gate is `!hasPeaks && contentPath !== null` →
   "Computing the waveform…", and `hasPeaks` is false for *both* "still computing"
   (`undefined`) and "computed, no peaks" (`null`). The FLAC lands in the second
   state and the message never clears.

The row-list `<Waveform>` does not have this symptom only because it silently falls
back to Freesound's pre-rendered PNG. The Edit view has no fallback and no error
state.

Two independent gaps, both fixed here:

- **`soundTask` gives up on any non-WAV/AIFF Original.** `editTask` in the same
  file already handles this case — it renders a throwaway PCM copy via
  `audioRenderRunner` (ffmpeg) and computes peaks from that (`computeViaScratchPcm`).
  `soundTask` should do the same.
- **The Edit view has no "no waveform" state.** Even after the fix above, a render
  can fail (corrupt download, unsupported codec, ffmpeg missing). The view must
  handle `peaks === null` distinctly from `peaks === undefined`.

---

## The fix — "decode anything" for a plain Sound

Mirror `editTask`'s existing scratch-PCM path in `soundTask`
(`core/peaks/peakService.ts`):

- Keep the fast path: if `sound.type` is in `LOCALLY_DECODABLE_TYPES`
  (`wav`, `aiff`), run the peak runner directly on the content-store Original as
  today.
- Otherwise, if `deps.audioRenderRunner` is set, render the Original to a
  throwaway `.wav` and run the peak runner on that, then delete it — the same
  shape as `computeViaScratchPcm`. Factor that helper so both `soundTask` and
  `editTask` use it (it currently takes an Edit's `localPath`; generalise it to
  any source path + a display name for metadata tags).
- If there is no `audioRenderRunner`, behave as today (return `null` → the
  service emits `unavailable`). Tests run without one; production always has
  ffmpeg-static wired (`src/main/index.ts` → `createFfmpegAudioRenderRunner`,
  already passed through `core/index.ts` to `createPeakService`).

Design notes:

- **Scratch file location.** `computeViaScratchPcm` writes
  `${localPath}.peaks-scratch-<hex>.wav` next to the source. For a plain Sound
  the source is the content-store Original; writing scratch files into the
  content store risks confusing the LRU sweep / sidecar scan. Write the scratch
  file under a temp dir (`dataDir`-scoped or `os.tmpdir()`) instead, and delete
  it in a `finally` regardless of outcome. Consider moving the Edit path to the
  same temp location while factoring the helper.
- **The undecodable sentinel still applies** — but now it means "even a full
  ffmpeg render could not turn this into PCM", which is a genuine dead end
  (`{ ok: false, undecodable: true }` only when the render step itself reports
  the source is not audio). A transient render failure (ffmpeg crash, disk full)
  must stay `undecodable: false` so a later `requestPeaks` retries and does not
  poison the cache.
- **Cost.** Freesound Originals opened for editing are sound-effect length; a
  one-shot ffmpeg decode-to-wav is cheap. No need for streaming or partial
  decode.
- This tightens ticket 12's acceptance ("audio that cannot be decoded falls back
  to its waveform image") rather than replacing it: we now try an ffmpeg render
  before concluding "cannot be decoded". The image fallback in `<Waveform>` is
  unchanged and still the row-list behaviour.

---

## The fix — a real "no waveform" state in the Edit view

`renderer/components/EditView.tsx` must treat the three `usePeaks` entry values
distinctly (they are already documented in `store/usePeaks.ts`):

| entry        | meaning                                  | Edit view shows                                  |
|--------------|------------------------------------------|-------------------------------------------------|
| `undefined`  | not resolved yet / still computing       | "Computing the waveform…" (as today)             |
| `null`       | resolved, no peaks available             | **new:** an inline error + guidance (see below)  |
| `PeaksPayload` | peaks present                           | the canvas waveform (as today)                   |

`contentPath === null` (Original not on disk) keeps its existing dedicated
message and takes precedence.

The new `peaks === null` state:

- Replaces the "Computing the waveform…" text — it must not be reachable once the
  entry resolves.
- Message, roughly: *"A waveform isn't available for this file. You can still
  export it — choose a different format in the export dialog if the export
  fails."* Wording to match the app's voice (`CONVENTIONS.md`).
- The region-select surface is fraction-based and does not need a waveform —
  decide whether to keep it interactive (select a region blind against the
  time readout) or disable region selection and offer whole-file export only.
  Recommended: keep it interactive; the start/end/duration readout still works,
  and loop-audition still works.
- **Export stays available.** `ExportDialog` renders via `audioRenderRunner` and
  does not depend on peaks. This is the user's escape hatch: if our render-based
  peak path failed for a format reason, exporting to WAV/MP3 through the same
  ffmpeg runner is the workaround, and the derived Edit will get its own computed
  waveform (`editTask`).
- `aria-live="polite"` on the state region so the transition from computing →
  error is announced.

---

## Acceptance criteria

- [x] A FLAC Original opened in the Edit view renders a canvas waveform (computed
      via an ffmpeg scratch-PCM render), zoomable and scrubbable like a WAV.
- [x] The same holds for MP3 and OGG Originals.
- [x] WAV and AIFF Originals still decode directly, with no ffmpeg render.
- [x] `soundTask` and `editTask` share one scratch-PCM helper; scratch files are
      written outside the content store and always cleaned up.
- [x] A genuine decode dead end (render reports "not audio") writes the
      undecodable sentinel and is never re-attempted; a transient render failure
      leaves the cache empty so a later visit retries.
- [x] When peaks resolve to "unavailable", the Edit view shows an inline error
      with guidance — never a perpetual "Computing the waveform…".
- [x] "Computing the waveform…" is shown only while the peaks entry is
      `undefined`.
- [x] Export remains available in the Edit view in the no-waveform state; an Edit
      derived from an undecodable-in-place parent still gets its own computed
      waveform.
- [x] The row-list `<Waveform>` image fallback is unchanged.
- [x] No blocking work added to the main or renderer thread — the render + sweep
      stay off-thread (worker for the sweep, spawned ffmpeg for the render).

## Tests

- [x] `test/peaks.test.ts`: a non-WAV/AIFF Sound Original is routed through the
      injected render runner and produces peaks; the runner is *not* called for a
      WAV Original.
- [x] Render-runner failure that reports "not audio" → undecodable sentinel
      written; transient failure → no cache row, retried on next `requestPeaks`.
- [x] Scratch file is deleted on both the success and failure paths.
- [x] `EditView` (renderer test): `peaks === undefined` → "Computing…";
      `peaks === null` → error/guidance copy, Export button still enabled;
      `peaks` payload → canvas.
- [x] Regression: opening the Edit view on an undecodable Original no longer
      leaves "Computing the waveform…" on screen after the entry resolves.

## Files

- `apps/desktop/src/core/peaks/peakService.ts` — `soundTask`, factor
  `computeViaScratchPcm`.
- `apps/desktop/src/renderer/components/EditView.tsx` — three-state peaks
  handling, new error state.
- `apps/desktop/src/renderer/store/usePeaks.ts` — no change expected; the
  `undefined` / `null` / payload contract is already there.
- `apps/desktop/src/renderer/lib/editViewState.ts` — new: `waveformDisplayState`,
  the pure four-state decision `EditView` renders from.
- `apps/desktop/src/core/db/migrations.ts` — `m005`, a one-time
  `DELETE FROM peaks WHERE bucket_count = 0` so libraries that predate this
  ticket recompute FLAC/MP3/OGG Originals through the new render path instead of
  staying stuck on the old sentinel.
- Tests: `apps/desktop/test/peaks.test.ts`,
  `apps/desktop/test/edit-view-state.test.ts`,
  `apps/desktop/test/db.migrations.test.ts`.
- `PROGRESS.md` — add a row once built.
