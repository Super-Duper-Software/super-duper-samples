// Throwaway spike renderer.

const logEl = document.getElementById("log");
const dragEl = document.getElementById("drag");
const deleteSourceEl = document.getElementById("deleteSource");

function log(msg) {
  logEl.textContent += "\n" + msg;
}

function currentMode() {
  const checked = document.querySelector('input[name="mode"]:checked');
  return checked ? checked.value : "single";
}

function opts() {
  return { mode: currentMode(), deleteSource: deleteSourceEl.checked };
}

// The real trigger: the browser's native dragstart event. We must call
// startDrag() synchronously from here (via IPC) for the OS drag to take over.
dragEl.addEventListener("dragstart", (e) => {
  e.preventDefault(); // hand off to Electron's native drag
  const o = opts();
  log("dragstart -> mode=" + o.mode + " deleteSource=" + o.deleteSource);
  window.spike.startDrag(o);
});

document.getElementById("fire").addEventListener("click", () => {
  const o = opts();
  log("manual fire -> mode=" + o.mode + " deleteSource=" + o.deleteSource);
  window.spike.startDrag(o);
});

window.spike.onDragStatus((payload) => {
  log("dragstatus: " + JSON.stringify(payload));
});
