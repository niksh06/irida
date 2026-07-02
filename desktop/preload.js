// Minimal, locked-down bridge: the renderer only learns about pet state and
// can ask to hide the overlay or quit the app. No Node APIs leak into the page.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("petAPI", {
  onState(cb) {
    ipcRenderer.on("pet:state", (_e, payload) => cb(payload));
  },
  hide() {
    ipcRenderer.send("pet:hide");
  },
  quit() {
    ipcRenderer.send("pet:quit");
  },
});
