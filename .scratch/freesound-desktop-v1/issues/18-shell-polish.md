# 18 — Shell polish

**What to build:** The app feels like a tool that belongs next to a DAW rather than a
browser in a costume. It opens quickly, resumes where the user left off, fits visually
alongside the dark applications it sits beside, and tells the user what is wrong when
something is wrong.

Most of this is small individually. Collectively it is the difference between an app people
use and one they try once. The specific failure this ticket prevents is the user being
unable to tell *slow* from *broken* — which is the state the app is in today, because
errors currently exist only in logs.

**Blocked by:** 11 — Library: save, view, delete.

**Status:** ready-for-agent

- [ ] The app opens quickly and is usable immediately, without a blank window while data loads.
- [ ] Window size and position are remembered across restarts.
- [ ] The last search, the last view and the current selection are restored on reopening.
- [ ] A dark theme is applied throughout and is visually coherent with the waveform recolouring from ticket 03.
- [ ] Every keyboard shortcut is discoverable from within the app via a shortcut reference.
- [ ] Shortcuts are consistent across search, Library and Collection views.
- [ ] Errors are surfaced in the interface, not only in logs — connectivity, throttling, authentication, download and disk failures each report distinctly.
- [ ] The user can always tell the difference between a slow operation and a failed one.
- [ ] Errors that the user can act on say what to do; errors they cannot act on say so plainly rather than suggesting a fix that does not exist.
- [ ] Long operations show progress rather than appearing frozen.
- [ ] Empty states — no results, empty Library, empty Collection — are informative rather than blank.
- [ ] The app's own logs are accessible from the interface for reporting problems.
