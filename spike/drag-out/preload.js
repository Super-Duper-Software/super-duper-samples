// Throwaway spike preload. Minimal contextBridge surface.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("spike", {
  startDrag: (opts) => ipcRenderer.send("ondragstart", opts),
  onDragStatus: (cb) =>
    ipcRenderer.on("dragstatus", (_evt, payload) => cb(payload)),
});
