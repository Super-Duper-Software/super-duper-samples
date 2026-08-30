# 07 — OAuth sign-in and sign-out

**What to build:** A user signs in to their own Freesound [Account](../../../CONTEXT.md)
through their real browser, sees their username in the app, and is still signed in days
later without repeating the process.

The app opens the system browser — never an embedded window, so the user's password
manager works and they can verify they are really on freesound.org — and catches the
authorization code on a one-shot loopback listener on a fixed port. The code goes to the
Worker from ticket 06, which holds `client_secret`. See
[ADR-0004](../../../docs/adr/0004-server-side-token-exchange.md).

Access tokens last 24 hours. Refresh must be proactive: a user must never discover they
are signed out in the middle of dragging a sound into a session.

Search and Preview audition continue to work while signed out. Only downloading requires
authentication.

**Blocked by:** 02 — App skeleton and first search; 06 — Token-exchange Worker.

**Status:** ready-for-agent

- [ ] Signing in opens the system browser at Freesound's authorization page; no credentials are ever entered inside the app.
- [ ] A one-shot loopback listener on the registered fixed port catches the authorization code and then shuts down.
- [ ] The code is exchanged via the Worker; the app never holds `client_secret`.
- [ ] The refresh token is encrypted with Electron's `safeStorage` and written to the app's user data directory. `keytar` is not used.
- [ ] The signed-in user's Freesound username is displayed in the app.
- [ ] The session survives quitting and reopening the app days later.
- [ ] Refresh happens proactively ahead of the 24-hour expiry, without user involvement.
- [ ] A 401 triggers exactly one refresh and one retry of the original request — never a loop.
- [ ] A failed refresh transitions the app to signed-out and surfaces a clear one-click re-authorization prompt.
- [ ] Signing out clears stored tokens but leaves the [Library](../../../CONTEXT.md) intact and playable.
- [ ] If the loopback port is already in use, sign-in fails with a specific error naming the port and the problem.
- [ ] Search and Preview audition remain fully functional while signed out, and the app makes clear that downloading and dragging require signing in.
- [ ] Tests cover: sign-in stores an encrypted refresh token; proactive refresh fires before expiry; a 401 causes exactly one refresh and one retry; a failed refresh signs out cleanly without looping; sign-out preserves the Library.
