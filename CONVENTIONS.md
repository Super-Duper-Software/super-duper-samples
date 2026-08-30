# Repo conventions (v1)

Read this before touching code. It exists so that tickets built by different sessions
agree on structure. It records **mechanical** choices only; behavioural decisions live in
`docs/specs/0001-v1.md` and `docs/adr/`.

## Layout — pnpm workspace

```
apps/desktop/        Electron app (electron-vite). The product.
  src/core/          Plain Node module. ALL behaviour. No Electron import, ever.
  src/main/          Electron main process. Thin adapter. No business logic.
  src/preload/       contextBridge surface. The core command API, forwarded verbatim.
  src/renderer/      React 19 + Tailwind. Presentation only. Reaches core via preload.
  test/             Vitest. Constructs the core in-process, no Electron.
  test/fixtures/     Recorded FreesoundGateway fixtures.
worker/              Cloudflare Worker (ticket 06). Own package, own deploy. wrangler.
spike/drag-out/      Ticket 01 throwaway. Discarded after. Do not invest in structure.
docs/findings/       Manual-verification writeups (tickets 01, 09).
```

Root `pnpm-workspace.yaml` lists `apps/*`, `worker`, `spike/*`.

## Toolchain

- **pnpm** (installed: 10.x). Node 24.
- **TypeScript** everywhere. `strict: true`.
- **Vitest** for all tests (app and worker).
- **electron-vite** for the desktop build; **electron-builder** for packaging (ticket 19, not now).
- **Prettier** defaults, no bikeshedding. ESLint optional and minimal.

## Config & secrets — never commit real values

Each package has `.env.example` (committed) and `.env` (git-ignored). Known keys:

| Key | Package | Purpose |
|---|---|---|
| `FREESOUND_API_KEY` | apps/desktop | Token auth for search + preview (no OAuth) |
| `FREESOUND_CLIENT_ID` | apps/desktop | OAuth authorization-code grant (public part) |
| `FREESOUND_TOKEN_WORKER_URL` | apps/desktop | Deployed ticket-06 Worker base URL |
| `FREESOUND_CLIENT_ID` | worker | OAuth client id |
| `FREESOUND_CLIENT_SECRET` | worker | **Worker secret only** (`wrangler secret put`). Never in code, response, or log. |

## Fixed constants

- OAuth loopback redirect URI: `http://localhost:8910/callback` — exactly one, registered
  with Freesound (ADR-0004). Port 8910.
- Freesound API base: `https://freesound.org/apiv2`.
- Content store: flat dir under Electron `userData`, files named `<soundId>.<ext>` (ADR-0002).
- Every downloaded Original gets a mandatory sidecar `<soundId>.json` (ADR-0002).

## The load-bearing rule (spec, repeated here because it is easy to erode)

If a behaviour cannot be exercised without launching Electron, it is in the wrong place.
The core's command API **is** the IPC contract. Tests attach to that seam with a fake
`FreesoundGateway` and a recording `DragHost`; SQLite and the filesystem are real temp
instances.
