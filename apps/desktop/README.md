# @freesound/desktop

The Freesound desktop client (Electron, built with electron-vite).

Ticket 02 delivers the thinnest complete path: a search box in the renderer that
returns a plain list of matching [Sound](../../CONTEXT.md) names, travelling
`renderer → contextBridge preload → core command → FreesoundGateway → Freesound`.

## Run it

```sh
# from the repo root
pnpm install

# copy the env template and add a Freesound token-auth key
cp apps/desktop/.env.example apps/desktop/.env
#   FREESOUND_API_KEY=...   (https://freesound.org/apiv2/apply/)

pnpm --filter @freesound/desktop dev      # hot reload across main + renderer
pnpm --filter @freesound/desktop test     # Vitest, no Electron
pnpm --filter @freesound/desktop build    # electron-vite production build
pnpm --filter @freesound/desktop typecheck
```

Search and Preview playback use **token auth only** — no OAuth, no sign-in. The
key is read from `.env` (git-ignored) via electron-vite's env handling; without it
search returns HTTP 401.

## Database (ticket 05)

Persistence is **SQLite** via [`better-sqlite3`](https://github.com/WiseLibraries/better-sqlite3)
(synchronous, native, well-supported in the Electron main process).

- **Native module.** `better-sqlite3` has a postinstall that fetches or builds a
  prebuilt binary. It is listed under `onlyBuiltDependencies` in the root
  `pnpm-workspace.yaml`; if a fresh `pnpm install` still skips it, run
  `pnpm approve-builds` (choose `better-sqlite3`) and reinstall. For a *packaged*
  Electron build (ticket 19) the binary must additionally be rebuilt against
  Electron's ABI (`electron-rebuild` / `@electron/rebuild`); that is out of scope
  here and the packaged app is not built in this environment.
- electron-vite marks it **external** for the main/preload bundles via
  `externalizeDepsPlugin()`, so the native `.node` file is never bundled — the
  main bundle just carries `require("better-sqlite3")`.

### Where the database lives — never the renderer thread

The DB is opened **in the core** (`src/core/db/`). The core runs in the Electron
**main** process in production and in a plain Node process under test. The
renderer never imports the core or `better-sqlite3` — it only ever calls
`window.core.*` over the contextBridge. That alone satisfies "never accessed from
the renderer's thread".

For **this** ticket every DB touch is a tiny indexed read or a single-row write,
so doing it synchronously inline in the core is fine. Heavier operations
introduced later — peak computation, rebuild-from-sidecars, bulk LRU eviction —
must additionally move off the **main** thread via `worker_threads`. No worker
pool is built yet; adding one now would be premature.

### Migrations

`src/core/db/migrations.ts` is an append-only, ordered list of
`{ id, name, up }` objects. `openDb(dbPath)` applies every migration whose `id`
exceeds `PRAGMA user_version`, each in its own transaction, then stamps
`user_version` and records a row in `schema_migrations`. Opening an up-to-date
database applies nothing. `PRAGMA foreign_keys = ON` is set on every open.

**Never edit or reorder an existing migration** — add a new one with the next id.

Migration `001` creates: `sounds`, `search_cache`, `library_entries`,
`collections`, `collection_members`, `staged_entries`, `peaks`, `auth`. Only
`sounds` and `search_cache` are used now; the rest are created empty so later
tickets only ADD columns/indexes.

### Search cache, debounce, prefetch

- **Cache key** — `sha256(canonicalJson(params))`, where `params` is an
  open-ended object of every value that affects a result page: today
  `{ query, page, pageSize }`; ticket 15 adds `{ sort, filters }`. Canonical JSON
  sorts keys recursively and drops `undefined`, so new params change the key with
  **no migration**. The `search_cache` row stores the ordered `sound_ids`,
  `total_count`, `has_more` and `fetched_at`; it is kept **indefinitely** (no
  TTL, no eviction). A hit reassembles the `SearchResult` by reading `sounds`
  rows — **zero gateway calls**. A miss makes exactly one gateway call, upserts
  every returned `Sound`, writes the cache row, and (fire-and-forget) prefetches
  the next page. A failed miss writes nothing.
- **Debounce** lives in the **core**, not the renderer:
  `createSearchController(core, { debounceMs })` (`src/core/searchController.ts`)
  coalesces rapid `query()` calls so only the trailing one reaches
  `core.search`. `core.searchDebounced(...)` delegates to one controller
  instance; `useSearch.ts` calls it on every keystroke and renders whatever
  resolves. This keeps the behaviour testable at the core seam (no renderer
  tests).
- **Prefetch** — on a miss with `hasMore`, the core kicks off
  `search(query, { page: n + 1 })` in the background. An in-flight map keyed by
  cache key holds both foreground and prefetch requests, so a real request for a
  page already being prefetched attaches to the same promise (no duplicate
  gateway call, no duplicate prefetch).

### Error types

`GatewayError` gained an optional `retryAfter` (seconds). A **429** is translated
by the core into `ThrottledError extends GatewayError` (`retryAfter` always a
number — `DEFAULT_RETRY_AFTER_SECONDS` when the response gave no `Retry-After`).
The renderer's `useSearch` classifies errors into `throttled` / `network` /
`generic` and the error UI shows the retry window for throttling. `NetworkError`
(connectivity) stays distinct from an empty result set (`totalCount === 0`).

### TanStack Query

**Not used.** The spec mentions it for the renderer search cache, but the SQLite
`search_cache` is the durable source of truth and already makes repeat/back
queries network-free; an extra in-memory layer would only duplicate it. If a
purely-visual cache is wanted later it can be added without touching the core.

## The core / adapter / renderer rule

From [`CONVENTIONS.md`](../../CONVENTIONS.md) — load-bearing, and easy to erode:

> If a behaviour cannot be exercised without launching Electron, it is in the
> wrong place. The core's command API **is** the IPC contract. Tests attach to
> that seam with a fake `FreesoundGateway` and a recording `DragHost`; SQLite and
> the filesystem are real temp instances.

Concretely:

| Layer | Directory | Rule |
|---|---|---|
| **Core** | `src/core/` | Plain Node module. ALL behaviour. **No `electron` import, ever** (enforced by `test/core.no-electron.test.ts`). `createCore({ gateway, dataDir, dbPath })` returns an object whose methods **are** the command API. |
| **Gateway** | `src/core/gateway/` | `FreesoundGateway` is the **sole** network boundary. `HttpFreesoundGateway` is the real impl; `FakeFreesoundGateway` replays fixtures from `test/fixtures/freesound/`. |
| **Main** | `src/main/` | Thin adapter. Constructs the core with `HttpFreesoundGateway`, `app.getPath('userData')` and a db path, then forwards each core method over `ipcMain.handle`. **No business logic.** |
| **Preload** | `src/preload/` | `contextBridge.exposeInMainWorld('core', …)` — the core command API forwarded verbatim. This surface **is** the IPC contract. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. |
| **Renderer** | `src/renderer/` | React 19 + Tailwind. Presentation only. Reaches the core **exclusively** through `window.core`. |

### Adding a command later

1. Add the method to `Core` in `src/core/index.ts` and implement it there.
2. Add it to `CoreApi` in `src/preload/index.ts` (one `ipcRenderer.invoke` line).
3. It is already reachable in the renderer as `window.core.<method>`. The generic
   `core:invoke` channel in `src/main/index.ts` means most commands need no
   main-process change at all.

Test it at the core seam with `makeTestCore()` (`test/helpers/makeTestCore.ts`) —
never by launching Electron.
