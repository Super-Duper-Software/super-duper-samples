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
