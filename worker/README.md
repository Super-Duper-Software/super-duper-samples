# @superduper/token-worker

A stateless Cloudflare Worker that holds the Freesound OAuth2 `client_secret` and
performs the two token exchanges a public desktop client cannot do for itself
(see [ADR-0004](../docs/adr/0004-server-side-token-exchange.md)).

The desktop app talks to Freesound directly for everything else — search,
previews, downloads. This Worker only ever sees an authorization code or a
refresh token, exchanges it, and returns the token JSON. The token path
**persists nothing**: no KV, no D1, no Durable Objects, no R2, no cache writes.
The two exceptions are write-only [Analytics Engine](#monthly-active-users) data
points — the anonymous monthly-active-user count and the anonymous
[error-category counts](#error-reports) — neither read back here.

## Endpoints

| Method + path   | Request body                        | Success response                                                      |
| --------------- | ----------------------------------- | -------------------------------------------------------------------- |
| `POST /exchange`| `{ "code": string, "redirect_uri"?: string, "install_id"?: string }` | Freesound token JSON: `{ access_token, refresh_token, expires_in, scope, token_type }` |
| `POST /refresh` | `{ "refresh_token": string, "install_id"?: string }`       | new token JSON (same shape)                                          |
| `POST /report`  | `{ "context": {...}, "events": [...] }` — see [Error reports](#error-reports) | `204` (validated + recorded, or validated + no-op when unbound) |
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

## Monthly active users

Because every running client refreshes its access token through `/refresh` about
once a day (and signs in through `/exchange`), this Worker is the one place that
sees every active install without the desktop app phoning home separately.

When **both** an Analytics Engine binding and the `MAU_HASH_SALT` secret are
configured, each `/exchange` and `/refresh` writes a single data point:

| field       | value                                                    |
| ----------- | -------------------------------------------------------- |
| `indexes[0]`| `SHA-256(MAU_HASH_SALT + ":" + install_id)` (hex)        |
| `blobs[0]`  | `"/exchange"` or `"/refresh"`                            |

The raw `install_id` (a random UUID the desktop app generates once per install)
is **never** stored, logged, or forwarded to Freesound — only the salted hash.
No `install_id` in the request, no binding, or no salt ⇒ nothing is written, and
the token exchange is unaffected either way. Writes are best-effort: a failure is
swallowed.

**Setup.** The `[[analytics_engine_datasets]]` block is already in
`wrangler.toml` (`binding = "MAU_ANALYTICS"`). Add the salt and deploy:

```sh
pnpm --filter @superduper/token-worker exec wrangler secret put MAU_HASH_SALT
pnpm --filter @superduper/token-worker exec wrangler deploy
```

To turn recording **off**, comment out the `[[analytics_engine_datasets]]` block
(or just never set `MAU_HASH_SALT`) and redeploy.

**Reading MAU.** Query the dataset over the last 30 days and count distinct
hashes ([Analytics Engine SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/)):

```sh
curl "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -d "SELECT count(DISTINCT index1) AS mau
      FROM freesound_token_worker_mau
      WHERE timestamp > now() - INTERVAL '30' DAY"
```

`blob1` splits it by endpoint if you want new sign-ins vs. returning refreshes.
Analytics Engine samples at high volume; treat the number as a trend, not a
ledger. Rotating `MAU_HASH_SALT` restarts the distinct count from zero.

## Error reports

`POST /report` is how the desktop app answers "is something broadly broken right
now?" — nothing more. The main process keeps an in-memory tally of failed
Previews / searches / downloads and, every few minutes, POSTs the tallies here.

**Request.**

```jsonc
{
  "context": {
    "version": "0.3.1",       // app version
    "platform": "win32",      // process.platform
    "arch": "x64",            // process.arch
    "osRelease": "10.0.19045" // os.release()
  },
  "events": [                 // 1..50 buckets
    {
      "code": "preview_failed",      // preview_failed | search_failed | download_failed
      "subReason": "element-error",  // a short closed-set slug (optional)
      "secondary": "MEDIA_ERR_NETWORK", // a second closed-set slug (optional)
      "online": 0,                   // navigator.onLine as 0 / 1 (optional)
      "count": 12                    // >= 1, clamped to 10000
    }
  ]
}
```

Every field is a closed-set enum, a short slug (`^[A-Za-z][A-Za-z0-9_-]{0,39}$`),
or an integer. Anything outside that shape — an unknown `code`, a free-text
`subReason`, a 51-entry array, a non-conforming context string — is a `400`
`{ error, hint }` and **nothing is written**. The Worker never stores a message,
stack trace, path, query, URL, or identifier, and there is no per-install index —
`code` is the only Analytics Engine index, so rows are counts, not a trail.

**Recording.** When the `ERROR_ANALYTICS` dataset is bound (its
`[[analytics_engine_datasets]]` block in `wrangler.toml` is **commented out by
default** — uncomment and redeploy to enable), each bucket becomes one data
point:

| field        | value                                                              |
| ------------ | ----------------------------------------------------------------- |
| `indexes[0]` | `code`                                                            |
| `blobs`      | `[code, version, platform, arch, osRelease, subReason, secondary]` |
| `doubles`    | `[online, count]` (`online` is `-1` when unknown)                  |

With no binding, `/report` still validates the body and returns `204`. Writes are
best-effort: a `writeDataPoint` failure is swallowed.

**Reading.** Sum `double2` (the count) — not `count()`, since one row already
stands for many occurrences:

```sh
curl "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -d "SELECT blob1 AS code, blob6 AS reason, blob2 AS version, blob3 AS os,
             SUM(double2) AS n
      FROM freesound_token_worker_errors
      WHERE timestamp > now() - INTERVAL '7' DAY
      GROUP BY code, reason, version, os
      ORDER BY n DESC"
```

A kind running well above its usual level against a fresh release or a single OS
is the signal. Compare it to the MAU number for rough affected-user scale.

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

   Optionally also set `MAU_HASH_SALT` here to enable the anonymous
   [monthly-active-user count](#monthly-active-users).

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
- **Per-IP, per-endpoint rate limit.** When the `SAMPLES_RATE_LIMITER` binding
  (`wrangler.toml` `[[ratelimits]]`) is present it is authoritative — global
  across isolates, keyed by `` `${cf-connecting-ip}:${path}` `` so a `/report`
  flood cannot spend an office's shared `/exchange` budget. Default 120 req/60s
  per key; over it → `429` with `Retry-After: 60`. When the binding is absent
  (`wrangler dev`, the test suite) the Worker falls back to a best-effort
  in-memory token bucket (`RATE_LIMIT_PER_MINUTE`, default 30) that only blunts a
  burst from a single isolate. Neither holds anything user-specific.

See [SECURITY.md](SECURITY.md) for what a public deployment must harden before
you rely on it.

## Open question (from ADR-0004 / spec 0001)

Confirm with the Freesound administrators whether the 60/min and 2000/day rate
limits are counted per `client_id` or per user access token. If per `client_id`,
every user shares one budget and the product cannot work as specified.
