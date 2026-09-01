# Setup — what a human has to do

Everything the agents could not do themselves. Nothing below is blocking for running
the test suites; it is required to run the app against the real Freesound.

## 1. Register a Freesound API application

Go to <https://freesound.org/apiv2/apply/> and create an application.

| Field | Value |
|---|---|
| **Redirect URI** | `http://localhost:8910/callback` — exactly this, one only. Freesound allows a single redirect URI per credential (ADR-0004); the app's loopback listener is hard-coded to port 8910. |
| Grant | Authorization Code (Freesound does **not** support PKCE) |

You get three things:

- **API key** (a.k.a. token / client secret's sibling for token-auth) → used for search + Preview streaming. Goes in `apps/desktop/.env` as `FREESOUND_API_KEY`.
- **Client ID** → `apps/desktop/.env` as `FREESOUND_CLIENT_ID`, **and** `worker/wrangler.toml` `[vars]`.
- **Client Secret** → **only** ever goes into the Cloudflare Worker as a secret. Never in the desktop app, never committed.

## 2. Confirm the rate-limit question BEFORE relying on OAuth in anger

Freesound's documented limits are **60 req/min and 2000 req/day**. The docs do not say
whether they are counted **per `client_id`** or **per user access token**. Ask the
Freesound admins.

- Per user token → fine, the design works.
- Per `client_id` → every user of the app shares one 2000/day budget and the product as
  specified **cannot work**. This invalidates the plan, not just inconveniences it
  (ADR-0004, spec §"The risk that invalidates this spec"). Ticket 07's flow is built and
  tested, but do not ship on it until this is answered.

## 3. Deploy the token Worker (ticket 06)

Needs a Cloudflare account. From `worker/`:

```
# one-time
wrangler login                       # or export CLOUDFLARE_API_TOKEN
# set the non-secret client id in wrangler.toml [vars] FREESOUND_CLIENT_ID
pnpm --filter @superduper/token-worker exec wrangler secret put FREESOUND_CLIENT_SECRET
pnpm --filter @superduper/token-worker exec wrangler deploy
```

Copy the printed `https://…workers.dev` URL. Rotation and local‑dev (`.dev.vars` +
`wrangler dev`) are in `worker/README.md`.

## 4. Fill in `apps/desktop/.env`

`cp apps/desktop/.env.example apps/desktop/.env`, then:

```
FREESOUND_API_KEY=<api key from step 1>
FREESOUND_CLIENT_ID=<client id from step 1>
FREESOUND_TOKEN_WORKER_URL=<deployed Worker URL from step 3>
# NO FREESOUND_CLIENT_SECRET here — it lives only in the Worker
```

## 5. Run the ticket 01 drag-out gate manually — do this before trusting the plan

`spike/drag-out/` proves whether drag-out works at all. The automated side only proves
the app boots and the file/hardlink plumbing is sound; **the actual drag was never
machine-tested and can't be.**

```
cd spike/drag-out
pnpm install            # if it says "Ignored build scripts: electron" → pnpm approve-builds
pnpm start
```

Work through `docs/findings/0001-drag-out-spike.md` §3: drag the box into **Logic Pro,
Audacity, Final Cut, Ableton Live, Finder** on **macOS**, and the equivalents +
**Explorer** on **Windows**; test multi-file drag (esp. Windows Explorer — electron#9019),
delete-source-after-drop, and the drag icon. If single-file drag into those apps works,
ticket 01 is a real GO and ticket 09 can proceed. If it doesn't, that's a project-level
NO-GO.

## 6. Native module note

`apps/desktop` uses `better-sqlite3` (native). It installs a prebuilt binary for your
Node; if you switch Node major versions or move to packaged-Electron you'll need
`pnpm rebuild better-sqlite3` (or `@electron/rebuild`, which ticket 19 handles).

## 7. Try the app

```
pnpm install
pnpm --filter @superduper/desktop dev
```

Search and Preview audition work with just `FREESOUND_API_KEY`. Sign-in, staged
downloads, and (once ticket 09 lands) drag-out need steps 1, 3, 4 done and the Worker
deployed.
