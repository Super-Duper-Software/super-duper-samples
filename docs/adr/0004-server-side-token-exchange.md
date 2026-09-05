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

## The app holds no API key at all — search is OAuth-only

Freesound issues one credential pair per application, and `FREESOUND_API_KEY` (token
auth) **is the same string as `client_secret`**. There is no separate, low-privilege key
we could bundle for anonymous search: bundling the key would bundle the secret. So the
app ships neither.

Every Freesound request the app makes — search included — therefore carries the
signed-in user's OAuth2 bearer token. The docs confirm `/search/text/`, `/sounds/<id>/`,
`/sounds/<id>/analysis/` and `/sounds/<id>/similar/` all accept a bearer token; only
downloads and write actions are "OAuth2 required" regardless. Search runs through the
same `authorized()` wrapper as `getMe` / download: one refresh + one retry on a 401.

The consequence for the product: **sign-in is mandatory before the first search.** The
renderer shows a sign-in gate in place of the search view until the user is signed in.
The Library and Collections views are local-only (SQLite + files already on disk) and
stay usable while signed out — signing out never deletes legitimately obtained files.

The authorization code is captured by a one-shot loopback listener on a fixed port
(`http://localhost:8910/callback`, the single redirect URI registered with Freesound).
Freesound registers exactly one redirect URI per credential, which rules out RFC 8252's
preferred dynamic-port loopback; a custom protocol handler was rejected because any
other application can register the same scheme and intercept the tokens.

## Consequences

This app is not fully offline-capable even in principle. Access tokens last 24 hours and
refreshing requires the Worker, so if the Worker is down every user is signed out within
a day — and with search now behind OAuth, a signed-out user cannot search at all (the
Library and Collections still work offline). The Worker must be treated as production
infrastructure, not a convenience.

Rate limits (60/min, 2000/day) may be counted per `client_id` rather than per user token
— the documentation does not say. If they are per-`client_id`, every user in the world
shares one 2000/day budget and the product does not work at all. This risk is now
**worse**: every search spends against that budget too, not just downloads. **Confirm
this with the Freesound administrators before building on this design**; it invalidates
the plan rather than inconveniencing it.
