# @superduper/token-worker

A stateless Cloudflare Worker that holds the Freesound OAuth2 `client_secret` and
performs the two token exchanges a public desktop client cannot do for itself
(see [ADR-0004](../docs/adr/0004-server-side-token-exchange.md)).

The desktop app talks to Freesound directly for everything else — search,
previews, downloads. This Worker only ever sees an authorization code or a
refresh token, exchanges it, and returns the token JSON. It **persists nothing**:
no KV, no D1, no Durable Objects, no R2, no cache writes.

## Endpoints

| Method + path   | Request body                        | Success response                                                      |
| --------------- | ----------------------------------- | -------------------------------------------------------------------- |
| `POST /exchange`| `{ "code": string, "redirect_uri"?: string }` | Freesound token JSON: `{ access_token, refresh_token, expires_in, scope, token_type }` |
| `POST /refresh` | `{ "refresh_token": string }`       | new token JSON (same shape)                                          |
| `OPTIONS *`     | —                                   | `204` + permissive CORS headers                                     |
| anything else   | —                                   | `404` / `405` with `{ error, hint }`                                |

Freesound's token endpoint is
`POST https://freesound.org/apiv2/oauth2/access_token/` with a form-encoded body
(`client_id`, `client_secret`, `grant_type`, `code` or `refresh_token`). No PKCE.
`redirect_uri` is not required by Freesound but is forwarded if the client sends
one.

### Error contract

Client errors (`400` / `404` / `405` / `403` / `429`) return
`{ "error": string, "hint": string }` — no stack traces, no upstream body.

Upstream Freesound failures return a machine-readable shape so the client
can branch:

```jsonc
{ "error": "reauthorize" | "retry", "upstream_status": number, "detail": string }
```

- `reauthorize` (HTTP `401`) — the grant is dead: `invalid_grant`, expired code,
  revoked/expired refresh token, bad client. The user must sign in again.
- `retry` (HTTP `503` / `502`) — transient: Freesound `5xx`, `429`, or a network
  error. Try again with backoff.

`detail` is upstream text with any `client_secret` occurrence stripped and the
length capped. The secret never appears in any response body, header, or error,
and is never logged.

## Local development

```sh
cp .dev.vars.example .dev.vars      # then edit in your real client secret
pnpm --filter @superduper/token-worker exec wrangler dev
```

`.dev.vars` is git-ignored and supplies `FREESOUND_CLIENT_SECRET` locally.
`FREESOUND_CLIENT_ID` and the optional soft controls come from `wrangler.toml`
`[vars]` (override them in `.dev.vars` if needed).

Example request against `wrangler dev`:

```sh
curl -sS -X POST http://localhost:8787/exchange \
  -H 'content-type: application/json' \
  -d '{"code":"<authorization-code>","redirect_uri":"http://localhost:8910/callback"}'
```

## Tests

```sh
pnpm --filter @superduper/token-worker test
pnpm --filter @superduper/token-worker exec tsc --noEmit
```

Vitest drives the exported `worker.fetch(request, env)` as HTTP-in / HTTP-out
against a stubbed global `fetch` standing in for Freesound's token endpoint. The
suite asserts, on the success path and on every error path, that
`client_secret` never appears in a response.

## Deploy

Prerequisites: a Cloudflare account, `wrangler` v4 (available globally), and
`wrangler login` (or `CLOUDFLARE_API_TOKEN` in the environment).

1. **Set the public client id** in `wrangler.toml` under `[vars]`:

   ```toml
   [vars]
   FREESOUND_CLIENT_ID = "your-freesound-client-id"
   ```

2. **Set the secret** (interactive prompt, stored encrypted by Cloudflare, never
   in the repo):

   ```sh
   pnpm --filter @superduper/token-worker exec wrangler secret put FREESOUND_CLIENT_SECRET
   ```

3. **Deploy:**

   ```sh
   pnpm --filter @superduper/token-worker exec wrangler deploy
   ```

   `wrangler deploy` prints the deployed URL (e.g.
   `https://freesound-token-worker.<subdomain>.workers.dev`). That URL is what
   goes into the desktop app's `FREESOUND_TOKEN_WORKER_URL`.

### Rotating `client_secret`

1. In the Freesound application settings, generate a new client secret (this
   leaves the old one valid until you revoke it).
2. Push the new value and redeploy:

   ```sh
   pnpm --filter @superduper/token-worker exec wrangler secret put FREESOUND_CLIENT_SECRET
   pnpm --filter @superduper/token-worker exec wrangler deploy
   ```

3. Confirm `/exchange` and `/refresh` still work against the live URL.
4. Revoke the old secret in the Freesound application settings.

The `client_id` is public; changing it is just a `wrangler.toml` edit plus
`wrangler deploy`.

## Abuse protection

- **Soft Origin / User-Agent allowlist.** `ALLOWED_ORIGINS` and
  `ALLOWED_USER_AGENTS` (comma-separated) in `wrangler.toml` `[vars]`. Unset =
  not enforced. Mismatches are logged and answered with `403`. The Electron main
  process sends no `Origin`, so an origin allowlist only affects browser callers.
- **Best-effort per-IP rate limit.** In-memory token bucket keyed by
  `cf-connecting-ip`, `RATE_LIMIT_PER_MINUTE` (default 30). This is **not**
  durable or global across isolates — it only blunts a burst from one isolate. A
  production deploy should use a Durable Object or Cloudflare rate-limiting
  rules. It holds nothing user-specific, so the Worker stays stateless.

See [SECURITY.md](SECURITY.md) for what a public deployment must harden before
you rely on it.

## Open question (from ADR-0004 / spec 0001)

Confirm with the Freesound administrators whether the 60/min and 2000/day rate
limits are counted per `client_id` or per user access token. If per `client_id`,
every user shares one budget and the product cannot work as specified.
