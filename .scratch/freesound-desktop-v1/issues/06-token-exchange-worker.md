# 06 — Token-exchange Worker

**What to build:** A deployed, stateless Cloudflare Worker that exchanges a Freesound
authorization code for tokens, and refreshes tokens, without ever exposing
`client_secret`.

Freesound implements the authorization code grant **without PKCE**, and `client_secret` is
mandatory for both exchange and refresh. A desktop app is a public client with nowhere to
keep a secret, so the exchange must happen server-side. See
[ADR-0004](../../../docs/adr/0004-server-side-token-exchange.md).

This is a separate deployable with its own small seam — HTTP request in, token response
out — and can be built and shipped entirely independently of the desktop app.

The Worker stores nothing. It never sees a user's audio, Library or search history, and it
must not acquire the ability to.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A Worker is deployed with an endpoint that accepts an authorization code and returns access and refresh tokens.
- [ ] A second endpoint accepts a refresh token and returns a new access token.
- [ ] `client_secret` is held as a Worker secret, never committed, and never appears in any response body, header or error message.
- [ ] The Worker is stateless — it persists nothing about any user or request.
- [ ] Malformed requests, missing parameters and unexpected methods are rejected with clear, non-leaking errors.
- [ ] Upstream failures from Freesound (invalid code, expired code, revoked refresh token) are passed through in a form the client can act on, distinguishing "retry" from "re-authorize".
- [ ] Only the app's own origin/user-agent expectations are honoured as far as is practical, and the endpoint is rate-limited against abuse.
- [ ] Tests drive the Worker as HTTP in, HTTP out, against a fake Freesound token endpoint.
- [ ] Tests explicitly assert that `client_secret` never appears in a response under any code path, including error paths.
- [ ] Deployment is reproducible and documented, including how to rotate `client_secret`.

**Note:** before relying on this design, confirm with the Freesound administrators whether
the 60/min and 2000/day rate limits are counted per `client_id` or per user access token.
If per `client_id`, every user shares one budget and the product cannot work as specified.
