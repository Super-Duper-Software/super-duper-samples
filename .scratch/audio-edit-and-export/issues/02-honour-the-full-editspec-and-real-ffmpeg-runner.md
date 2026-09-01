# 02 — Honour the full EditSpec + real ffmpeg runner

**What to build:** The export now does the real work. A sound designer can mark a region of
the source and export only that region, and can pick the output format (WAV, MP3, FLAC,
OGG) with optional sample rate, mono/stereo and loudness-normalise. A long export shows
progress and can be cancelled. The finished file carries the original's title, author and
License in its metadata tags.

This ticket makes the `audioRenderRunner` a real thing: a main-process runner that shells
out to the bundled `ffmpeg-static` binary in one invocation. Packaging / signing the binary
is **not** in scope — that is v1 ticket 19; development uses the binary from `node_modules`.

**Blocked by:** 01 — Export a Library Sound as an Edit.

**Status:** done — code + tests (`test/edits.test.ts`, `test/edits.trim.test.ts`,
`test/ffmpegRunner.smoke.test.ts`)

- [x] The edit spec is honoured end to end: `trim` ({ startSec, endSec } or null), `format`, optional `sampleRate`, optional `channels` (1 or 2), optional `normalize`.
- [x] A trimmed Edit's Sounds row and sidecar record the resulting (shorter) duration, and its format/sample rate/channels reflect the chosen output, not the source.
- [x] Trim bounds are clamped to the source duration and a zero-or-negative-length region is rejected before any render starts.
- [x] The production `audioRenderRunner` lives in the main process, spawns `ffmpeg-static` once per export (trim + encode + resample + downmix + normalise in a single command), and never runs inside the core.
- [x] Render progress (0–1) is pushed on an `onEditProgress` listener, shaped like the existing staging / peaks status listeners.
- [x] `cancelEdit` aborts the ffmpeg process promptly and removes any partial output.
- [x] The output file's metadata tags carry the parent Sound's title, author and License URL.
- [x] A source that ffmpeg cannot decode, or an encode failure, surfaces as a clear terminal error on `onEditProgress` — distinct from cancellation — and writes nothing.
- [x] Exporting the whole file with no format change is still permitted (a plain named copy).
- [x] Core-seam tests continue to run against the fake `audioRenderRunner`; they assert that the spec passed to the runner matches the caller's request (trim window, format, rate, channels, normalise) and that a trimmed Edit reports the shorter duration.
- [x] The real runner has a smoke test that renders a short fixture through `ffmpeg-static` and checks the output is a valid file of the requested format; deeper verification is manual.

## Notes for the frontier

- `resolveTrim` (`src/core/edits/trim.ts`) is the pure clamp/validate helper — throws
  `InvalidTrimError` for a zero-or-negative-length region, exported from `src/core` alongside
  `pickEditName`.
- The real runner (`src/main/ffmpegRunner.ts`) parses ffmpeg's own `Duration:` stderr banner
  and its `-progress pipe:1` `out_time=` lines for progress; it never shells out to a second
  `ffprobe` binary (not bundled by `ffmpeg-static`).
- `pnpm-workspace.yaml`'s `onlyBuiltDependencies` now includes `ffmpeg-static` so its
  postinstall (binary download) actually runs under pnpm's default script-blocking.
- No `src/main` IPC / preload wiring for `createEdit` / `cancelEdit` / `subscribeEditProgress`
  yet — unchanged from ticket 01's note; that lands with the Edit view (07/08).
- Loudness-normalise is single-pass `loudnorm=I=-16:TP=-1.5:LRA=11` (EBU R128 defaults), not
  the two-pass measure-then-apply flow — good enough for a sound-effect-length clip; revisit
  if a tester finds it audibly off.
