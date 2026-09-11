# @superduper/desktop

The Super Duper Samples desktop client (Electron, built with electron-vite).

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

pnpm --filter @superduper/desktop dev      # hot reload across main + renderer
pnpm --filter @superduper/desktop test     # Vitest, no Electron
pnpm --filter @superduper/desktop build    # electron-vite production build
pnpm --filter @superduper/desktop typecheck
```

Search and Preview playback use **token auth only** — no OAuth, no sign-in. The
key is read from `.env` (git-ignored) via electron-vite's env handling; without it
search returns HTTP 401.

## Building a release (ticket 19)

Packaging is **`electron-builder`** driven by `electron-builder.yml`. The release
is **unsigned for distribution** and has **no auto-update**.
The end-user side of the same story is [`INSTALL.md`](../../INSTALL.md).

```sh
pnpm --filter @superduper/desktop pack:dir   # unpacked .app/.exe, no installer — fast smoke test
pnpm --filter @superduper/desktop pack:mac   # SDS-<v>-arm64.dmg + SDS-<v>-x64.dmg  → apps/desktop/dist/
pnpm --filter @superduper/desktop pack:win   # SDS-Setup-<v>.exe (per-user NSIS)     → apps/desktop/dist/
pnpm --filter @superduper/desktop icon       # regenerate resources/icon.icns + .ico from icon.svg (macOS)
```

- **Native + binary payloads.** `electron-builder.yml` rebuilds `better-sqlite3`
  for the target Electron ABI (`npmRebuild: true`) and `asarUnpack`s it and
  `ffmpeg-static` so they load at runtime. `resources/drag-icon.png` (ticket 09
  fallback) ships as an `extraResource` at `process.resourcesPath`.

  > **After a local `pack:*` / `pack:dir`,** `better-sqlite3` in the pnpm store is
  > left compiled against Electron's ABI, so `pnpm test` and `pnpm dev` fail with
  > `NODE_MODULE_VERSION` mismatch. Restore the Node build with
  > `pnpm rebuild -r better-sqlite3` from the repo root. CI is unaffected — each
  > workflow job starts from a clean install.
- **macOS signing.** `scripts/electron-builder-after-pack.mjs` applies an **ad-hoc**
  signature (`codesign --sign -`). This is required — Apple Silicon refuses a
  bundle with no signature. It is *not* Developer ID and *not* notarized, so first
  launch shows the Gatekeeper prompt (`INSTALL.md` covers the user side).
- **The icon.** `resources/icon.svg` is the master; `icon.icns` / `icon.ico` are
  generated from `resources/icon-1024.png` (itself rendered from the SVG) and
  committed, so a build never depends on the `icon` script running.
- **Config baked in at build time.** `electron-vite build` inlines
  `FREESOUND_CLIENT_ID` and `FREESOUND_TOKEN_WORKER_URL` from `.env`. A released
  build with those blank cannot sign in, so Search is dead. The ticket-06 Worker
  must also be deployed (`SETUP.md` §3).

### CI

- **`.github/workflows/release.yml`** — push a `v*` tag (or run it manually).
  Builds the three installers on `macos-latest` / `windows-latest`, generates
  `SHA256SUMS.txt`, and opens a **draft** GitHub Release. The two Freesound values
  come from repo **variables** (`Settings → Secrets and variables → Actions →
  Variables`), not secrets — there are no signing secrets.
- **`.github/workflows/build-check.yml`** — every PR and push to main runs tests,
  typecheck and `electron-builder --dir` on both OSes. No upload.

### Rolling back a bad release

There is no update channel. Delete the GitHub Release and its tag, fix, and cut a
new tag. Users on the bad build re-download from the releases page; their Library,
downloaded files and sign-in (all under Electron `userData`) are untouched by
reinstalling.

## Authentication (ticket 07)

Sign-in is an **OAuth2 authorization-code grant** against Freesound, with **no
PKCE** (Freesound does not support it) and **no `client_secret` in the app**.
The secret lives only in the ticket-06 Cloudflare Worker.

Flow, all driven by the **core** (`src/core/auth/`), tested with no Electron:

1. `core.signIn()` generates a random `state`, opens the user's **real system
   browser** at
   `https://freesound.org/apiv2/oauth2/authorize/?client_id=…&response_type=code&state=…`
   — never an in-app login form.
2. A **one-shot loopback listener** binds the fixed port **8910** and serves
   `GET /callback`. Freesound registers exactly one redirect URI,
   `http://localhost:8910/callback` (`CONVENTIONS.md`). It captures
   `?code=&state=`, the core verifies `state`, the listener replies with a tiny
   "you can close this tab" page and **shuts down**. Port already in use →
   `LoopbackPortInUseError` ("port 8910 is already in use …"). Timeout / user
   never authorizes → `SignInCancelledError`, cleanly.
3. The code is exchanged **via the Worker** (`POST ${FREESOUND_TOKEN_WORKER_URL}/exchange`).
   The core then fetches `GET https://freesound.org/apiv2/me/` (Bearer) for the
   **username**, shown in the header ("Signed in as X / Sign out").
4. The **refresh token** is encrypted with Electron **`safeStorage`** (via the
   injected `AuthPlatform` — **`keytar` is not used**) and stored, together with
   the username, as one blob in the `auth` table (`refresh_token_enc`), alongside
   `access_token_expires`. The **access token stays in memory only**.
5. On relaunch the core reads the encrypted blob, restores `signedIn` + username
   immediately, and refreshes on demand before the first authenticated call —
   search and audition never wait on it.
6. **Proactive refresh** is scheduled 5 min before the 24 h expiry through an
   injectable `Scheduler`, and reschedules itself on success. It fires with no
   user involvement.
7. **401 interceptor** (`AuthController.authorized(fn)`, used by tickets 08/09):
   any authenticated call that 401s triggers **exactly one** refresh and
   **exactly one** retry — never a loop. A dead refresh (Worker says
   `reauthorize`), or a still-401 retry, clears the stored token and transitions
   to `signedOut` with `reauthRequired: true`; the renderer shows a one-click
   "Sign in again". A transient refresh failure (`retry`) keeps the session.
8. **Sign-out** deletes only the `auth` row. `library_entries`, `sounds`,
   `collections`, `staged_entries`, `peaks` and every downloaded file are left
   intact (CONTEXT.md § Account). Search + Preview keep working while signed out;
   a subtle "Sign in to download & drag" hint is shown.

### Config

`.env` needs `FREESOUND_CLIENT_ID` and `FREESOUND_TOKEN_WORKER_URL` for sign-in
(search/preview still work without them). **`FREESOUND_CLIENT_SECRET` is never in
this app** — only in the Worker (`wrangler secret put`).

`/exchange` and `/refresh` also carry a random per-install id (`src/main/installId.ts`,
stored at `<userData>/install-id`) so the Worker can keep an anonymous
monthly-active-user count — the Worker only ever stores a salted hash of it, and it
never reaches Freesound.

The main process also keeps an in-memory tally of failed Previews / searches /
downloads (`src/main/errorTelemetry.ts`) and POSTs the counts to the Worker's
`/report` every few minutes: app version, OS, a fixed error kind, and a count —
never a message, path, query, URL, or id, and never linked to an install.

`SDS_TELEMETRY=0` (or `false`/`off`/`no`) in `.env` disables both; see
`worker/README.md` § "Monthly active users" and § "Error reports".

### Manual verification (needs a real browser + real Freesound + a deployed Worker)

Automated tests cannot exercise the real browser round-trip. To check it by hand:

1. Deploy the Worker (`worker/README.md`) and note its URL.
2. In the Freesound API application settings (https://freesound.org/apiv2/apply/),
   register the **redirect URI** exactly as `http://localhost:8910/callback`
   (the only one Freesound allows per credential).
3. Put `FREESOUND_CLIENT_ID` (from Freesound) and `FREESOUND_TOKEN_WORKER_URL`
   (the deployed Worker) in `apps/desktop/.env`. Leave `FREESOUND_CLIENT_SECRET`
   out — it belongs only in the Worker.
4. `pnpm --filter @superduper/desktop dev`, click **Sign in**, authorize in the
   browser, confirm the username appears and survives a quit + relaunch.

## Database (ticket 05)

Persistence is **SQLite** via [`better-sqlite3`](https://github.com/WiseLibraries/better-sqlite3)
(synchronous, native, well-supported in the Electron main process).

- **Native module.** `better-sqlite3` has a postinstall that fetches or builds a
  prebuilt binary. It is listed under `onlyBuiltDependencies` in the root
  `pnpm-workspace.yaml`; if a fresh `pnpm install` still skips it, run
  `pnpm approve-builds` (choose `better-sqlite3`) and reinstall. For a *packaged*
  Electron build the binary is rebuilt against Electron's ABI by
  `@electron/rebuild`, which electron-builder runs automatically (`npmRebuild: true`
  in `electron-builder.yml`) — see "Building a release" below.
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

## Staging — staged download on audition (ticket 08)

Pressing play streams the [Preview](../../CONTEXT.md) (ticket 04, 100% in the
renderer) **and** tells the core to speculatively download the
[Original](../../CONTEXT.md) so the Sound is on disk and draggable a moment
later. The downloaded file is [Staged](../../CONTEXT.md): a complete Original on
disk with **no `library_entries` row**.

### Commands & events (what the renderer calls)

| Command | Purpose |
|---|---|
| `core.stageOnAudition(soundId)` | Fire-and-forget. Enqueue a background download of the Original; cancel the previous audition's download first (see below). No-op while signed out, before consent, or for an unknown Sound. If already on disk, just bumps `last_access_at`. |
| `core.cancelStaging(soundId)` | Cancel a sound's queued/in-flight staged download (the renderer calls this on Stop). |
| `core.getStagingStatus(ids)` | `Record<number, StagingStatus>` for the row indicators. |
| `core.getStagingConsent()` / `core.grantStagingConsent()` | The first-run consent gate (below). |
| `core:event:stagingStatus` | Push (`{ soundId, status }`) on every status transition. Preload exposes it as `window.core.onStagingStatus(listener)`. |

`useTransport.playSound` calls `stageOnAudition`; each result row shows a
`<StagingChip>` fed from `useStaging` (a Zustand mirror of the push channel).

### Staging status state machine

```
not-started ──stageOnAudition──▶ queued ──slot free──▶ downloading ──files written──▶ ready
                                   ▲                        │  │
                                   └──retry (backoff)───────┘  └──retries exhausted──▶ failed
   cancel(soundId) / skip ────────────────────────────────────────────────────────▶ not-started
```

`ready` is also reported immediately for any Sound with a `staged_entries` **or**
`library_entries` row. `failed` is sticky until the Sound is auditioned again
(then it gets one fresh full run). The renderer shows `downloading` (slow) and
`failed` → "unavailable" as visually distinct states.

### The download queue

`src/core/staging/downloadQueue.ts` — a standalone, injectable module:

- **Concurrency cap** `DOWNLOAD_CONCURRENCY = 3` — never more than 3 downloads in
  flight (test asserts the observed max ≤ 3 when many are enqueued).
- **Retry** `DOWNLOAD_MAX_RETRIES = 3`, backoff `DOWNLOAD_RETRY_BACKOFF_MS =
  [1000, 3000, 9000]` ms, scheduled through the injected `Scheduler` (ticket 07)
  so tests advance it. During the backoff the concurrency slot is released.
- **Permanent failure** — after retries are exhausted the Sound's status becomes
  `failed` and the queue stops touching it.
- **Cancel on skip (the design chosen):** the renderer calls `stageOnAudition(id)`
  on every play. The core remembers the previous audition and, when a new one
  arrives, **cancels the previous download unless it already finished or was
  saved** (has a `library_entries` row). A queued job is dropped outright; an
  in-flight one is aborted via `AbortSignal` (the gateway rejects with an
  `AbortError`). Skimming a result list therefore never leaves more than one
  speculative download alive.
- **Already-on-disk is a no-op** — the queue and controller check the content
  store + `staged_entries` / `library_entries` before enqueueing.

`gateway.downloadOriginal(id, accessToken, { signal })` is the authenticated
network call: `GET /apiv2/sounds/<id>/download/` with a Bearer token, run through
`AuthController.authorized()` so a 401 refreshes **once** and retries **once**
(never a loop). It streams the response body and honours `signal`.

### Content store (ticket 14 depends on this shape)

Originals are written to `<dataDir>/content/`, flat, named by Freesound sound id
with the Sound's own extension: `321967.wav`. Next to each sits its **mandatory**
sidecar `321967.json`. Both files are written to a `*.part` temp name
and atomically renamed — the sidecar first, the Original last — so an
`<id>.<ext>` file always implies its sidecar is present.

```jsonc
{
  "schemaVersion": 1,
  "soundId": 321967,
  "freesoundUrl": "https://freesound.org/people/klankbeeld/sounds/321967/",
  "downloadedAt": 1693267200000,           // epoch ms
  "author":  { "username": "klankbeeld" },
  "license": { "url": "http://creativecommons.org/licenses/by/4.0/", "name": "CC-BY" },
  "file":    { "name": "321967.wav", "ext": "wav", "byteSize": 6127544 },
  "sound":   { /* the full core `Sound` object, verbatim */ }
}
```

`sound` + `author` + `license` + `freesoundUrl` are enough for ticket 14 to
reconstruct a `sounds` row (and a `library_entries` row for saved files).

### `staged_entries` (ticket 10 reads this)

When an Original lands, the controller upserts a `staged_entries` row:
`sound_id`, `byte_size`, `last_access_at` (epoch ms, bumped on **every**
re-audition), `path` (absolute path in the content store), `created_at` (epoch ms,
set once). It also upserts the `sounds` row. `last_access_at` is the column the
ticket calls "last-accessed"; `path` and `created_at` are added by **migration
002** (see below). Ticket 10's eviction must skip any Sound that also has a
`library_entries` row (the spec: eviction never touches a Library Sound) — this
ticket records the state, it does not evict.

### Migration 002 (`staging-content-store`)

Added because `staged_entries` from migration 001 lacked `path` / `created_at`,
and consent needed somewhere to live:

```sql
ALTER TABLE staged_entries ADD COLUMN path       TEXT;
ALTER TABLE staged_entries ADD COLUMN created_at INTEGER;
CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

`test/db.migrations.test.ts` is updated (`user_version` is now `2`).

### First-run consent (spec story 52)

Before staging takes effect the first time, the user is told "auditioning
downloads sounds against your Freesound account's record". Stored as
`app_meta.staging_consent_at` (epoch ms). `core.getStagingConsent()` returns
`{ grantedAt }`; `core.grantStagingConsent()` sets it once (idempotent). Until
granted, `stageOnAudition` does not download. The renderer shows a one-time
`<StagingConsentBanner>` with an "OK, got it" button, only while signed in.

### Signed out

`stageOnAudition` is a silent no-op when `getAuthState().status !== 'signedIn'`.
Auditioning (search + Preview) is unaffected — those are token-auth.

### Manual GUI check

Automated tests prove the core hands the right bytes to disk; only a person can
watch it happen live:

1. `pnpm --filter @superduper/desktop dev`, sign in (see Authentication above —
   needs a deployed Worker + real Freesound credentials).
2. Run a search. The amber consent banner appears once — click **OK, got it**.
3. Press ▶ on a row. Within a second or two its chip goes
   `downloading → ready`. Confirm a file appears at
   `<userData>/content/<id>.<ext>` with a sibling `<id>.json`.
4. Press ▶ rapidly down several rows (or hold **J**). Only the row you land on
   ends at `ready`; the ones you skimmed past return to no chip, and no more
   than 3 downloads ever run at once (watch the network panel).
5. Kill wi-fi and press ▶ — after the retries the chip shows **unavailable**
   (red), distinct from the blue **downloading**.

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
