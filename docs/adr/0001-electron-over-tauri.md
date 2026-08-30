# Electron over Tauri, despite the size and memory cost

The one feature this product cannot ship without is dragging an audio file out of our
window and into Logic Pro, Audacity or Final Cut. Electron's `webContents.startDrag()`
is a first-party, long-stable API that does exactly this on macOS and Windows; Tauri's
equivalent lives in the third-party `tauri-plugin-drag`. We accept a ~150MB bundle and
Chromium's memory footprint in exchange for the highest-risk feature in the project
resting on a first-party API rather than a community plugin.

Splice — the app we are explicitly imitating on responsiveness — is itself Electron,
which is sufficient evidence that the performance target is reachable here.

## Consequences

Snappiness is now our responsibility rather than the framework's. Virtualized lists,
keeping playhead state out of the React render path, debounced search, and never
touching SQLite on the main thread are load-bearing decisions, not optimisations.

Multi-file drag-out is known to be broken on Windows
([electron#9019](https://github.com/electron/electron/issues/9019) — an array of paths
dropped into Explorer yields one file). Single-item drag is the reliable path;
multi-select drag must be verified per-platform before it is offered in the UI.
