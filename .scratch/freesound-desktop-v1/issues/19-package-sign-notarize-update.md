# 19 — Package for macOS and Windows (unsigned)

**What to build:** A stranger can download Super Duper Samples from a GitHub
Releases page, get past the one operating-system warning with a single documented
click, and use the app — search, audition, save, drag a sound into their DAW.

Scope was cut from the original "public auto-updating product" to "unsigned
installers + icon + a first-run guide" — see **`docs/adr/0007`** for the decision
and its consequences. Signing, notarization, and auto-update are explicitly *not*
in this ticket and can be added later without rework.

**Blocked by:** all preceding tickets.

**Status:** built — see `PROGRESS.md`. Verification steps below are for a human.

## Acceptance criteria

- [x] `electron-builder` packages the electron-vite `out/` build into installers:
      two macOS DMGs (`SDS-<version>-arm64.dmg`, `SDS-<version>-x64.dmg`) and one
      Windows per-user NSIS installer (`SDS-Setup-<version>.exe`).
- [x] Native `better-sqlite3` is rebuilt for the packaged Electron ABI, and it
      plus `ffmpeg-static` are `asarUnpack`ed so they load at runtime. The
      ticket-09 fallback `drag-icon.png` ships as an `extraResource`.
- [x] A **custom application icon** (`resources/icon.svg` master → committed
      `icon.icns` / `icon.ico`, regenerable with `pnpm --filter
      @superduper/desktop icon`): a full-bleed hard square, brand orange ground,
      blocky white "SDS", hard offset shadow, teal strip. Respects `brand/BRAND.md`.
- [x] The macOS bundle carries an **ad-hoc signature** (`afterPack` hook) so
      Apple Silicon launches it; `codesign --verify` passes. It is **not**
      Developer ID signed and **not** notarized — first launch shows the normal
      Gatekeeper prompt.
- [x] The Windows installer is unsigned (SmartScreen "unrecognised publisher" on
      first run) and installs per-user with no admin prompt.
- [x] A release workflow (`.github/workflows/release.yml`) triggered by a `v*`
      tag or manual dispatch builds all three installers on GitHub-hosted
      runners, generates `SHA256SUMS.txt`, and opens a **draft** GitHub Release.
      The two non-secret Freesound build values come from repo **variables**.
- [x] A `build-check` workflow runs `electron-builder --dir` + tests + typecheck
      on every PR and push to main, so packaging breakage is caught before a tag.
- [x] `marketing/first-run.md` documents, with space for screenshots: which file
      to download for which machine, the macOS "Open Anyway" flow (and the
      pre-Sequoia right-click route and the `xattr` one-liner), the Windows
      "More info → Run anyway" flow, and a tour of the first-run in-app
      experience (sign-in gate, browser OAuth, audition consent, search, drag-out,
      Credits).
- [x] `docs/adr/0007` records the ship-unsigned / no-auto-update decision.
      `SETUP.md` notes that a released build needs the Freesound values baked in
      and the Worker deployed. `apps/desktop/README.md` gains a "Building a
      release" section including how to roll back (delete the release + tag).

## Left for a human (cannot be done in this environment)

- [ ] Run `pnpm --filter @superduper/desktop pack:mac` on a Mac and
      `pack:win` on Windows (or push a `v0.1.0` tag and let CI do it). Confirm the
      four artifacts appear in `apps/desktop/dist/`.
- [ ] Set the GitHub Actions repository variables `FREESOUND_CLIENT_ID` and
      `FREESOUND_TOKEN_WORKER_URL`, and deploy the ticket-06 Worker (`SETUP.md`
      §3), or a released build cannot sign in and Search is dead.
- [ ] Install each artifact on a machine that has never run a dev build. Walk
      `marketing/first-run.md` exactly as written and fix any step that doesn't
      match what the OS actually shows (wording drifts between macOS versions).
- [ ] Re-run the ticket-01 drag-out matrix (`SETUP.md` §5,
      `docs/findings/0002`) against the **installed** app on both platforms —
      packaging changes the executable path and the resource layout, so a fresh
      drag test into Logic / Ableton / Finder (macOS) and the equivalents +
      Explorer (Windows) is required before announcing a release.
- [ ] Capture the screenshots listed at the top of `marketing/first-run.md`.
