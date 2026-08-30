# 02 — App skeleton and first search

**What to build:** A user opens the app, types a query, and sees a plain list of matching
[Sound](../../../CONTEXT.md) names. That is the entire visible feature — but delivering it
end to end establishes every structural decision the rest of the backlog depends on.

This is the thinnest possible complete path: renderer → contextBridge → core command →
`FreesoundGateway` → Freesound → back. Search and Preview playback need only token
authentication, so no OAuth is involved yet.

The structural rules established here are load-bearing and must not erode later: all
behaviour lives in the core as a plain Node module with no Electron dependency; the
Electron main process is a thin adapter containing no business logic; the core's command
API *is* the IPC contract; the renderer reaches the core only through the preload bridge.
If a behaviour cannot be exercised without launching Electron, it is in the wrong place.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] An Electron app builds and runs on macOS and Windows via electron-vite, with hot reload across main and renderer.
- [ ] `contextIsolation` is on and `nodeIntegration` is off; the renderer reaches the main process only through a `contextBridge` preload surface.
- [ ] The core exists as a plain Node module, constructible and drivable in an ordinary Node process with no Electron present.
- [ ] The core exposes a `search` command that returns Sounds for a text query.
- [ ] `FreesoundGateway` exists as the sole network boundary, with a fake implementation driven by recorded fixtures.
- [ ] Search requests ask for the complete field set needed to render a result row, so one result page costs exactly one gateway call regardless of page size and no per-Sound detail request is ever made.
- [ ] The renderer renders returned Sound names in a plain unstyled list.
- [ ] A test harness constructs the core in-process with the fake gateway, a temporary directory and a temporary database, with no Electron.
- [ ] Tests cover: a query returns Sounds; an empty result set is distinguishable from a failure; a network failure surfaces as an error rather than an empty list.
- [ ] The API key for token authentication is configurable and not committed.
- [ ] A short note records the core/adapter/renderer rule for future contributors.
