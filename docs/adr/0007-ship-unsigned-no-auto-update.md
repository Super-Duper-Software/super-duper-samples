# Ship unsigned, with no auto-update

Ticket 19 as originally written asks for the full public-product release
machinery: a Developer ID certificate and Apple notarization, Windows
Authenticode signing, clean-machine verification, Squirrel-based auto-update,
migration tests against a prior released schema, and CI holding signing secrets.

We are not doing most of that. The release is **unsigned for distribution** and
has **no auto-update**. What ships is: reproducible installers for macOS and
Windows, a custom application icon, a GitHub Releases download, and a written
first-run guide that walks a stranger through the operating-system warning.

## Why

A Developer ID / Authenticode certificate is a recurring cost tied to a vendor
identity we don't want to stand up yet, and notarization + signing is the single
biggest source of release friction. Auto-update is the thing that most depends on
signing: Squirrel.Mac refuses an unsigned update, and a self-rolled updater
brings back exactly the CI-secrets-and-hosting weight we're trying to avoid. The
source is public, so the app is as trustworthy as its code; the OS simply can't
attest that automatically. We would rather ship now and add signing later than
block the first release on it.

## What this means

- **macOS builds carry an ad-hoc signature** (`codesign --sign -`, applied in the
  electron-builder `afterPack` hook). This is not optional: Apple Silicon will
  not launch a bundle with *no* signature — it reports it as "damaged". With the
  ad-hoc signature the user instead gets the normal, dismissable Gatekeeper
  prompt, which `INSTALL.md` walks through (System Settings →
  Privacy & Security → "Open Anyway"; `xattr -dr com.apple.quarantine` for the
  Terminal-comfortable).
- **Windows builds are an unsigned per-user NSIS installer.** First run hits
  SmartScreen "unrecognised publisher" → "More info" → "Run anyway". Per-user
  (`perMachine: false`, `allowElevation: false`) means no admin prompt.
- **Two macOS DMGs (`arm64`, `x64`), one Windows `x64` installer.** No universal
  binary — it doubles download size and complicates the native `better-sqlite3`
  rebuild for no benefit when we ship both slices anyway. No Linux target.
- **Distribution is manual GitHub Releases.** A tag (`v*`) triggers a build
  workflow that produces the artifacts and a `SHA256SUMS.txt` and opens a
  **draft** release; a human reviews and publishes. The two non-secret Freesound
  values the client needs (`FREESOUND_CLIENT_ID`, `FREESOUND_TOKEN_WORKER_URL` —
  see ADR-0004; the client id is explicitly safe to ship) are injected at build
  time from GitHub Actions repository **variables**, not secrets. The
  ticket-06 Worker must be deployed (`SETUP.md` §3) for sign-in, and therefore
  Search, to work in a released build.
- **"Updating" is: download the new version and install it over the old one.**
  The installers preserve the [Library](../../CONTEXT.md), the content store and
  the encrypted credentials (all under Electron `userData`, which the installer
  never touches). Schema migrations still run forward on launch as they always
  have (`apps/desktop/README.md` § Migrations), and the ticket-14
  rebuild-from-sidecars path remains the recovery net if a migration ever leaves
  the database unusable. We are not adding cross-version migration tests as part
  of this ticket.
- **No rollback process**, because there is no update channel to roll back. A bad
  release is handled by deleting the GitHub release and its tag and cutting a new
  one.

## Cost of this choice

Every new user pays a one-time ~30-second detour past an OS warning that reads as
"this might be malware", and some fraction of them will not proceed. Shipping a
fix means every existing user must notice the announcement and re-download; a
bug in a released build is effectively permanent for anyone who doesn't. Both are
accepted for now. Adding Developer ID + notarization + a signed auto-updater
later is additive — it does not invalidate anything built here (the
electron-builder config grows a `mac.notarize` block and a `publish` provider;
the CI gains secrets).

## Status

Packaging is implemented at this reduced scope: unsigned installers, ad-hoc
macOS signature, custom icon, first-run guide (`INSTALL.md`), no notarization,
no auto-update.
