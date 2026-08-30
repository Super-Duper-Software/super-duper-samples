# A server-side token exchange, in an otherwise serverless desktop app

Freesound's OAuth2 implements RFC 6749's authorization code grant **without PKCE**, and
`client_secret` is mandatory both to exchange a code and to refresh a token. A desktop
app is a public client with nowhere to keep a secret — an Electron `asar` is unpacked in
one command — so shipping the secret means shipping it to everyone.

We therefore run one stateless Cloudflare Worker whose only job is to hold
`client_secret` and perform the code-for-token and refresh-token exchanges. Everything
else — search, downloads, all authenticated API calls — goes from the client straight to
Freesound with the user's bearer token. The Worker stores nothing and never sees a
user's audio, library or search history.

The authorization code is captured by a one-shot loopback listener on a fixed port
(`http://localhost:8910/callback`, the single redirect URI registered with Freesound).
Freesound registers exactly one redirect URI per credential, which rules out RFC 8252's
preferred dynamic-port loopback; a custom protocol handler was rejected because any
other application can register the same scheme and intercept the tokens.

## Consequences

This app is not fully offline-capable even in principle. Access tokens last 24 hours and
refreshing requires the Worker, so if the Worker is down every user is signed out within
a day. It must be treated as production infrastructure, not a convenience.

Rate limits (60/min, 2000/day) may be counted per `client_id` rather than per user token
— the documentation does not say. If they are per-`client_id`, every user in the world
shares one 2000/day budget and the product does not work at all. **Confirm this with the
Freesound administrators before building on this design**; it invalidates the plan rather
than inconveniencing it.
