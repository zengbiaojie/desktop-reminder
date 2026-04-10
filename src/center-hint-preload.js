const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("centerHintApi", {
  onShow: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_, text) => handler(text);
    ipcRenderer.on("center-hint:show", listener);
    return () => ipcRenderer.removeListener("center-hint:show", listener);
  }
});
