# Repo conventions (v1)

Read this before touching code. It exists so that tickets built by different sessions
agree on structure. It records **mechanical** choices only; behavioural decisions live in
`docs/specs/0001-v1.md`.

## Layout — pnpm workspace

```
apps/desktop/        Electron app (electron-vite). The product.
  src/core/          Plain Node module. ALL behaviour. No Electron import, ever.
  src/main/          Electron main process. Thin adapter. No business logic.
  src/preload/       contextBridge surface. The core command API, forwarded verbatim.
  src/renderer/      React 19 + Tailwind. Presentation only. Reaches core via preload.
  test/              Vitest. Constructs the core in-process, no Electron.
  test/helpers/      Shared test seam: `makeTestCore`, fakes, scenarios, fixtures.
                     Import from `./helpers` (the barrel), not the modules directly.
  test/fixtures/     Recorded FreesoundGateway fixtures.
worker/              Cloudflare Worker. Own package, own deploy. wrangler.
```

Root `pnpm-workspace.yaml` lists `apps/*` and `worker`.

## Toolchain

- **pnpm** (installed: 10.x). Node 24.
- **TypeScript** everywhere. `strict: true`.
- **Vitest** for all tests (app and worker).
- **electron-vite** for the desktop build; **electron-builder** for packaging
  (`apps/desktop/electron-builder.yml`, ticket 19 — unsigned).
- **Prettier** defaults, no bikeshedding. ESLint optional and minimal.
- **Comments**: code and `/** … */` JSDoc only. No narrative or rationale prose in
  `//` comments — put the "why" in a commit message, an ADR, or a test name. Directive
  comments (`@ts-expect-error`, `eslint-disable`, `/// <reference>`, build pragmas) are
  fine.

## Config & secrets — never commit real values

Each package has `.env.example` (committed) and `.env` (git-ignored). Known keys:

| Key | Package | Purpose |
|---|---|---|
| `FREESOUND_CLIENT_ID` | apps/desktop | OAuth authorization-code grant (public part). Required — no API key is bundled, so search runs on the user OAuth token |
| `FREESOUND_TOKEN_WORKER_URL` | apps/desktop | Deployed ticket-06 Worker base URL. Required (see above) |
| `SDS_TELEMETRY` | apps/desktop | Optional. `0`/`false`/`off`/`no` stops the app sending its random install id to the Worker for the anonymous MAU count. Default: on |
| `FREESOUND_CLIENT_ID` | worker | OAuth client id |
| `FREESOUND_CLIENT_SECRET` | worker | **Worker secret only** (`wrangler secret put`). Never in code, response, or log. |
| `MAU_HASH_SALT` | worker | **Worker secret only.** Optional. Salt for the anonymous monthly-active-user hash. Unset ⇒ nothing is recorded |

## Fixed constants

- OAuth loopback redirect URI: `http://localhost:8910/callback` — exactly one, registered
  with Freesound. Port 8910.
- Freesound API base: `https://freesound.org/apiv2`.
- Content store: flat dir under Electron `userData`, files named `<soundId>.<ext>`.
- Every downloaded Original gets a mandatory sidecar `<soundId>.json`.

## The load-bearing rule (spec, repeated here because it is easy to erode)

If a behaviour cannot be exercised without launching Electron, it is in the wrong place.
The core's command API **is** the IPC contract. Tests attach to that seam with a fake
`FreesoundGateway` and a recording `DragHost`; SQLite and the filesystem are real temp
instances.
