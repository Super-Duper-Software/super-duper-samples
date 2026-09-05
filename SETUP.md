# Setup — running against the real Freesound

Nothing here is needed to run the test suites (`pnpm -r test`). It is what you do
to point the app at a live Freesound account.

The app bundles **no** API key. Every Freesound call, search included, is made with
the signed-in user's OAuth2 token (ADR-0004), so nothing works until sign-in works,
and sign-in needs your own token-exchange Worker deployed.

## 1. Register a Freesound API application

Go to <https://freesound.org/apiv2/apply/> and create an application.

| Field | Value |
|---|---|
| **Redirect URI** | `http://localhost:8910/callback` — exactly this, one only. Freesound allows a single redirect URI per credential (ADR-0004); the app's loopback listener is hard-coded to port 8910. |
| Grant | Authorization Code (Freesound does **not** support PKCE) |

You get two values:

- **Client ID** → `apps/desktop/.env` as `FREESOUND_CLIENT_ID`, **and** `worker/wrangler.toml` `[vars]` (or the Worker's `.dev.vars` / CI). Public.
- **Client Secret** → **only** ever the Cloudflare Worker, set with `wrangler secret put`. Never in the desktop app, never committed.

## 2. Know the rate-limit question

Freesound's documented limits are **60 req/min and 2000 req/day**. The docs do not say
whether they are counted **per `client_id`** or **per user access token**. Since search
now spends against this budget too, confirm with the Freesound admins before relying on
it at any scale:

- Per user token → fine.
- Per `client_id` → every user of your build shares one 2000/day budget (ADR-0004).

## 3. Deploy the token Worker

Needs a Cloudflare account. From `worker/`:

```
wrangler login                       # or export CLOUDFLARE_API_TOKEN
# set FREESOUND_CLIENT_ID in wrangler.toml [vars] (or .dev.vars / CI)
pnpm --filter @superduper/token-worker exec wrangler secret put FREESOUND_CLIENT_SECRET
pnpm --filter @superduper/token-worker exec wrangler deploy
```

Copy the printed `https://…workers.dev` URL. Operational hardening, rotation and
local dev (`.dev.vars` + `wrangler dev`) are in `worker/README.md` and
`worker/SECURITY.md`.

## 4. Fill in `apps/desktop/.env`

`cp apps/desktop/.env.example apps/desktop/.env`, then:

```
FREESOUND_CLIENT_ID=<client id from step 1>
FREESOUND_TOKEN_WORKER_URL=<deployed Worker URL from step 3>
# no FREESOUND_CLIENT_SECRET here — it lives only in the Worker
```

## 5. Native module note

`apps/desktop` uses `better-sqlite3` (native). It installs a prebuilt binary for your
Node; if you switch Node major versions you'll need `pnpm rebuild better-sqlite3`. A
packaged build rebuilds it against Electron's ABI via `@electron/rebuild`
(`npmRebuild: true` in `electron-builder.yml`).

## 6. Try the app

```
pnpm install
pnpm --filter @superduper/desktop dev
```

Search, sign-in and staged downloads all need steps 1, 3 and 4 done and the Worker
deployed. Drag-out into a DAW cannot be exercised by the test suite — verify it by
hand against the running app.

## 7. Building a release (unsigned)

Full detail is in `apps/desktop/README.md` § "Building a release" and `docs/adr/0007`.
The essentials:

- **Deploy the Worker** (step 3). A released build with no Worker URL cannot sign in,
  so Search is dead.
- **Bake the client config into the build.** `pack:mac` / `pack:win` read
  `apps/desktop/.env` at build time, so `FREESOUND_CLIENT_ID` and
  `FREESOUND_TOKEN_WORKER_URL` must be set (the client id is safe to ship — ADR-0004).
  In CI they come from GitHub Actions repository **variables** of the same names, not
  secrets.
- **Cut a release** by pushing a `v*` tag; `.github/workflows/release.yml` builds the
  two DMGs + the NSIS installer and opens a **draft** GitHub Release with
  `SHA256SUMS.txt`. Review, then publish.
- **Before announcing**, install each artifact on a clean machine, walk `INSTALL.md`,
  and re-check drag-out against the installed app.
- The builds are **unsigned** (macOS ad-hoc only, Windows not at all) and there is **no
  auto-update**. Rolling back a bad release = delete the release and its tag.
