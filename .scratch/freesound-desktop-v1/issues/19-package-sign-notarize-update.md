# 19 — Package, sign, notarize, update

**What to build:** A stranger downloads the app and it just opens — no security warnings, no
right-click workarounds, no hunting for a download page when a fix ships.

This is what makes it a public product rather than something that runs on the developer's
machine. On macOS, an unsigned and unnotarized app is actively obstructed by the operating
system, and most users will not get past that. Auto-update matters because a shipped bug in
a desktop app is otherwise permanent for whoever does not think to check back.

**Blocked by:** all preceding tickets.

**Status:** ready-for-agent

- [ ] The app builds reproducibly into distributable installers for macOS and Windows.
- [ ] The macOS build is signed with a Developer ID certificate and successfully notarized.
- [ ] The macOS build opens on a clean machine with no security warning and no right-click-to-open workaround.
- [ ] The Windows build is signed and installs without an unrecognised-publisher warning.
- [ ] Both platforms are verified on a machine that has never run a development build.
- [ ] Auto-update is implemented, checks on a sensible schedule, and applies updates without the user visiting a website.
- [ ] An update never destroys or corrupts the [Library](../../../CONTEXT.md), the content store, or stored credentials.
- [ ] Database migrations run correctly on update, and are tested from at least one prior released schema version.
- [ ] Update failures degrade gracefully — the existing version keeps working.
- [ ] Signing credentials and secrets are held securely in CI and are not committed.
- [ ] The release process is documented, including how to roll back a bad release.
- [ ] Before release, the manual drag-out matrix from ticket 01 is re-verified against the signed builds on both platforms.
