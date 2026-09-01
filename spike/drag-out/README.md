# @superduper/spike-drag-out

**Throwaway spike — ticket 01.** Discarded after the findings doc is written. Do not
build on this code. No tests, no abstractions, no reuse.

Proves that a real audio file can be dragged out of an Electron window into a DAW /
editor / file manager, and exercises the variants ticket 09 depends on.

## Run

From the repo root:

```
pnpm --filter @superduper/spike-drag-out install
pnpm --filter @superduper/spike-drag-out start
```

Or from this directory:

```
pnpm install
pnpm start              # `prestart` regenerates asset/sample.wav + asset/icon.png, then electron .
```

`node generate-wav.mjs` and `node make-icon.mjs` (or `npm run gen-assets`) regenerate
the two assets by hand. The drag **icon must be a real PNG** — an invalid one decodes
to an empty `nativeImage` and `startDrag` silently never fires (that bug bit the first
cut of this spike; see the Correction in the findings doc).

If `pnpm install` prints "Ignored build scripts: electron", run
`pnpm approve-builds` (or `node node_modules/electron/install.js`) once so the
Electron binary is downloaded.

## What it does

- One window, one hardcoded file: `asset/sample.wav` (3s, 16-bit PCM, 44.1kHz stereo,
  440Hz left / 660Hz right, committed).
- One draggable box. Its `dragstart` calls `event.preventDefault()` and sends an IPC
  message; the **main process** calls `event.sender.startDrag({ file, icon })`.
- Radio buttons pick the mode:
  - **drag single** — `startDrag({ file: <abs path>, icon })`.
  - **drag multi (2 files)** — `startDrag({ file, files: [wav, /tmp copy], icon })`.
    Known broken on Windows Explorer (electron#9019); works on macOS.
  - **drag hardlink copy** — `fs.linkSync`s the wav into a temp dir as
    `My Dragged Sound.wav` and drags that link. This is the ticket-09 path.
- Checkbox **delete source file 3s after dragstart** — `fs.rmSync`s the source wav
  3s after the drag starts, to test whether the receiver copied or referenced it.
  (The committed asset is restored by re-running `node generate-wav.mjs`.)

## Smoke test (no GUI)

```
SPIKE_SMOKE=1 pnpm start   # boots the window, prints a line, exits 0
```

## Files

| file               | role                                                  |
| ------------------ | ----------------------------------------------------- |
| `main.js`          | Electron main; `ipcMain.on('ondragstart', …)` → `startDrag` |
| `preload.js`       | `contextBridge` surface (`window.spike.startDrag`)    |
| `index.html`       | the in-window UI                                      |
| `renderer.js`      | `dragstart` → IPC                                     |
| `generate-wav.mjs` | writes + validates `asset/sample.wav`                 |
| `asset/sample.wav` | the file that gets dragged (committed)                |

Findings and the manual verification checklist: `docs/findings/0001-drag-out-spike.md`.
