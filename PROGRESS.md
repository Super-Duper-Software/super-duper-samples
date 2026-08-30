# Progress

Tracer-bullet backlog: `.scratch/freesound-desktop-v1/`. Stopped at ticket 08 by request.

| # | Ticket | State | Commit |
|---|---|---|---|
| 01 | Drag-out platform spike | **spike built; icon bug found & fixed; manual GUI drag test NOT yet run** (see SETUP.md §5) | `f16f812`, `812d81d` |
| 02 | App skeleton + first search | done | `f16f812` |
| 03 | Result rows + virtualized list | done | `812d81d` |
| 04 | Audition via Preview | done | `921ada0` |
| 05 | SQLite + search cache | done | `533c010` |
| 06 | Token-exchange Worker | done (not deployed — SETUP.md §3) | `f16f812` |
| 07 | OAuth sign-in / sign-out | done (needs Worker + Freesound app to exercise) | `0a502cb` |
| 08 | Staged download on audition | done | `4ed08ee` |
| 09 | Real drag-out — **the milestone** | not started | — |
| 10–19 | eviction, Library, peaks, collections, manifest, packaging | not started | — |

## Test counts at stop

- `apps/desktop`: 85 vitest tests, `tsc --noEmit` clean, `electron-vite build` clean.
- `worker`: 30 vitest tests, `tsc --noEmit` clean.
- `spike/drag-out`: syntax-checked only (throwaway).

## To resume at 09

09 is blocked only by 01 (manual verification) + 08 (done). Once you've run the
SETUP.md §5 drag test and it passes, ticket 09 wires `DragHost` around
`webContents.startDrag`, hardlinks the staged Original into a temp dir under a
human-readable name, and hands that path to the OS. Everything it needs from 08 is in
place: the content store at `dataDir/content/<id>.<ext>`, `staged_entries`, and the
`ready` staging status.

## Known follow-ups noted by the ticket agents

- Rate-limit question (SETUP.md §2) must be answered before shipping OAuth.
- `better-sqlite3` needs a rebuild on Node/Electron ABI changes (ticket 19 / `@electron/rebuild`).
- Renderer bundle is ~620 kB and unsplit — fine for an Electron app, revisit at ticket 18.
- Hand-crafted Freesound fixtures (`apps/desktop/test/fixtures/freesound/`) should be
  re-recorded against a real API key.
