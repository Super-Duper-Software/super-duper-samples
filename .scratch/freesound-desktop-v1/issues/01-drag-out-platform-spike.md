# 01 — Drag-out platform spike

**What to build:** Proof that a file can be dragged out of an Electron window and land
correctly in the applications this product exists to serve. A throwaway app with a single
hardcoded audio file and nothing else — no search, no auth, no library. The deliverable is
knowledge, not code: whether [Drag-Out](../../../CONTEXT.md) works on every target
platform and receiving application, and what its limitations are.

This ticket gates the entire project. If drag-out cannot be made to work, nothing else in
this backlog is worth building, and that must be discovered now rather than in month
three. See [ADR-0001](../../../docs/adr/0001-electron-over-tauri.md).

The code is expected to be discarded. Do not invest in structure, tests or reuse.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A minimal Electron app displays one draggable element backed by a real audio file on disk.
- [ ] Dragging it into **Logic Pro** places the audio on a track at its native quality.
- [ ] Dragging it into **Audacity** imports the audio.
- [ ] Dragging it into **Final Cut Pro** adds it to the browser or timeline.
- [ ] Dragging it into **Ableton Live** places it in the session.
- [ ] Dragging it into **Finder** (macOS) and **Explorer** (Windows) produces a normal, complete, self-contained file.
- [ ] All of the above verified on **both macOS and Windows**, with results recorded per platform.
- [ ] Multi-file drag is attempted with an array of paths, and the actual per-platform behaviour is documented — specifically whether Windows delivers every file or only one.
- [ ] Behaviour when the dragged path is a **hardlink** rather than a regular file is verified, since the real implementation depends on this.
- [ ] Behaviour when the source file is **deleted after the drop** is verified, to confirm the receiving application copied rather than referenced it.
- [ ] The drag icon is confirmed to render, and the failure mode of passing an empty icon on macOS is observed and noted.
- [ ] Findings are written up as a short document: what works, what does not, and any per-platform constraints the implementation must respect.
- [ ] A go/no-go recommendation is stated explicitly.
