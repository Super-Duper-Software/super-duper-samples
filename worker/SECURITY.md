# Deploying the token Worker safely

The Worker in this directory is deliberately minimal. It holds the Freesound
OAuth2 `client_secret`, exchanges an authorization code or refresh token, and
returns the token JSON. It persists nothing and logs nothing sensitive
(`worker/src/index.ts` strips any `client_secret` occurrence from upstream text
and caps its length; the test suite asserts this on every code path).

What ships here is **not** a hardened production deployment. If you deploy a
Worker that other people's builds point at, you own the following:

## Rate limiting

`wrangler.toml` binds the platform rate limiter as `SAMPLES_RATE_LIMITER`
(`[[ratelimits]]`, 120 req/60s per `` `${cf-connecting-ip}:${path}` ``). It is
global across isolates and authoritative when present. `src/index.ts` falls back
to a best-effort in-memory per-IP-per-endpoint bucket (`RATE_LIMIT_PER_MINUTE`,
default 30) only when the binding is absent — `wrangler dev` and the test suite.

Pick a `namespace_id` unique within your Cloudflare account and tune `limit` for
your user base (shared-NAT offices count as one IP). If you want a hard edge
before the Worker even runs, add a
[Cloudflare rate-limiting rule](https://developers.cloudflare.com/waf/rate-limiting-rules/)
on the route as well.

## Error reports endpoint

`POST /report` is unauthenticated (like `/exchange`). It accepts only a closed
schema — known event codes, short slugs, capped array length, integer counts —
and returns `400` on anything else without writing. It stores no message, path,
query, URL, or identifier, and `ERROR_ANALYTICS` is commented out in
`wrangler.toml` by default, so a fresh deploy records nothing until you opt in.
It is still an ingest surface: keep the rate limiter bound so it cannot be used
to flood Analytics Engine or bury a real signal with fake counts.

## Caller allowlist

`ALLOWED_ORIGINS` and `ALLOWED_USER_AGENTS` (comma-separated, in `wrangler.toml`
`[vars]` or `.dev.vars`) ship **empty**, i.e. not enforced. Set
`ALLOWED_USER_AGENTS` to a substring your build sends so casual reuse of your
deployment by other clients is rejected. The Electron main process sends no
`Origin`, so an `Origin` allowlist only affects browser callers.

This is a soft control — a `User-Agent` is trivially spoofed — but it raises the
bar past copy-paste.

## Secret hygiene

- `FREESOUND_CLIENT_SECRET` is a Cloudflare Worker secret
  (`wrangler secret put`), never a `[vars]` entry, never committed. `.dev.vars`
  (git-ignored) supplies it locally only.
- Rotate it periodically, and immediately if you suspect exposure. The procedure
  is in [README.md](README.md#rotating-client_secret): add the new secret, deploy,
  verify `/exchange` and `/refresh`, then revoke the old one in the Freesound
  application settings.

## Blast radius

The Worker can only mint tokens for authorization codes and refresh tokens that
Freesound already issued against your `client_id`. It is not an open token
oracle. The realistic abuse cases are (a) another client riding your deployment
and your registered app's rate budget, addressed by the allowlist above, and
(b) plain request-flooding of the endpoint, addressed by the rate limiting above.
