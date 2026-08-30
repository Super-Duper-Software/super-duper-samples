// Throwaway spike (ticket 01). No abstractions, no reuse. One window, one wav.
//
// The drag itself is done the plain Electron way: the renderer fires an IPC
// message on `dragstart`, and the main process calls event.sender.startDrag().

const { app, BrowserWindow, ipcMain, nativeImage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const WAV = path.join(__dirname, "asset", "sample.wav");

// A second real file for the multi-file drag test. Just copy the wav.
const WAV_2 = path.join(os.tmpdir(), "freesound-spike-sample-2.wav");
try {
  fs.copyFileSync(WAV, WAV_2);
} catch (err) {
  console.error("could not stage second file:", err.message);
}

// A tiny drag icon. On macOS startDrag() THROWS if the icon is empty/invalid,
// so we always hand it a real bitmap. 1x1 transparent PNG is enough to not throw,
// but we build a small visible square so the drag image is observable.
function dragIcon() {
  // 32x32 solid-ish square, encoded as a data URL PNG.
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAP0lEQVR42u3PMQ0AAAgDMOZf" +
    "9BvAA7pJq2Tt2gEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8G0BES0AAWfC" +
    "yV8AAAAASUVORK5CYII=";
  const img = nativeImage.createFromDataURL("data:image/png;base64," + png);
  return img;
}

function makeHardlinkCopy() {
  // Ticket 09 depends on dragging a hardlink, not the real file. Link the wav
  // into a temp dir under a human-readable name and return THAT path.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "freesound-spike-hl-"));
  const linkPath = path.join(dir, "My Dragged Sound.wav");
  try {
    fs.linkSync(WAV, linkPath);
  } catch (err) {
    // Cross-device fallback: copy. (Temp dir is normally same volume on macOS.)
    console.error("hardlink failed, copying instead:", err.message);
    fs.copyFileSync(WAV, linkPath);
  }
  return linkPath;
}

function maybeDeleteSourceLater(shouldDelete, targets) {
  if (!shouldDelete) return;
  setTimeout(() => {
    for (const t of targets) {
      try {
        fs.rmSync(t, { force: true });
        console.log("[delete-source] removed", t);
      } catch (err) {
        console.error("[delete-source] failed for", t, err.message);
      }
    }
  }, 3000);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 520,
    height: 620,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile("index.html");
  // win.webContents.openDevTools({ mode: "detach" });
}

ipcMain.on("ondragstart", (event, opts) => {
  const mode = (opts && opts.mode) || "single";
  const deleteSource = !!(opts && opts.deleteSource);

  let files;
  let cleanupTargets;

  if (mode === "multi") {
    const a = WAV;
    const b = WAV_2;
    files = [a, b];
    cleanupTargets = [a, b];
  } else if (mode === "hardlink") {
    const link = makeHardlinkCopy();
    files = [link];
    // Deleting the *source* wav (not the link) is the interesting test for
    // ticket 09: does the OS drag copy bytes at dragstart, or lazily?
    cleanupTargets = [WAV];
  } else {
    files = [WAV];
    cleanupTargets = [WAV];
  }

  const icon = dragIcon();
  if (icon.isEmpty()) {
    // Would throw on macOS. Report it instead of crashing the spike.
    event.reply("dragstatus", {
      ok: false,
      mode,
      error: "drag icon is empty — startDrag would throw on macOS",
    });
    return;
  }

  try {
    if (files.length === 1) {
      event.sender.startDrag({ file: files[0], icon });
    } else {
      // `files:` array — multi-file drag. Known broken on Windows Explorer
      // (electron#9019 yields one file); works on macOS.
      event.sender.startDrag({ file: files[0], files, icon });
    }
    maybeDeleteSourceLater(deleteSource, cleanupTargets);
    event.reply("dragstatus", {
      ok: true,
      mode,
      files,
      deleteSourceScheduled: deleteSource,
    });
  } catch (err) {
    event.reply("dragstatus", { ok: false, mode, error: String(err) });
  }
});

app.whenReady().then(() => {
  if (!fs.existsSync(WAV)) {
    console.error(
      "asset/sample.wav is missing. Run `node generate-wav.mjs` first.",
    );
  }
  createWindow();
  // Smoke test hook: `SPIKE_SMOKE=1 electron .` boots the window and exits 0.
  if (process.env.SPIKE_SMOKE) {
    setTimeout(() => {
      console.log("[smoke] window created, no startup crash — exiting 0");
      app.exit(0);
    }, 2500);
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
