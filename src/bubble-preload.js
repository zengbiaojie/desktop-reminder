const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bubbleApi", {
  restoreMainWindow: () => ipcRenderer.invoke("window:restore-from-bubble"),
  hideBubble: () => ipcRenderer.invoke("window:hide-bubble"),
  startBubbleDrag: (x, y) => ipcRenderer.invoke("window:start-bubble-drag", { x, y }),
  endBubbleDrag: () => ipcRenderer.invoke("window:end-bubble-drag"),
  showBubbleMenu: () => ipcRenderer.invoke("window:show-bubble-menu"),
  getUrgentCount: () => ipcRenderer.invoke("events:get-urgent-count")
});
