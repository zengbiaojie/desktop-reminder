const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bubbleApi", {
  restoreMainWindow: () => ipcRenderer.invoke("window:restore-from-bubble"),
  hideBubble: () => ipcRenderer.invoke("window:hide-bubble"),
  startBubbleDrag: (x, y) => ipcRenderer.invoke("window:start-bubble-drag", { x, y }),
  endBubbleDrag: () => ipcRenderer.invoke("window:end-bubble-drag"),
  showBubbleMenu: () => ipcRenderer.invoke("window:show-bubble-menu"),
  getUrgentCount: () => ipcRenderer.invoke("events:get-urgent-count"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  onSettings: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_, payload) => handler(payload);
    ipcRenderer.on("bubble:settings", listener);
    return () => ipcRenderer.removeListener("bubble:settings", listener);
  }
});
