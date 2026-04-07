const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("reminderApi", {
  listEvents: () => ipcRenderer.invoke("events:list"),
  addEvent: (payload) => ipcRenderer.invoke("events:add", payload),
  updateEvent: (payload) => ipcRenderer.invoke("events:update", payload),
  toggleEvent: (id) => ipcRenderer.invoke("events:toggle", id),
  deleteEvent: (id) => ipcRenderer.invoke("events:delete", id),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (patch) => ipcRenderer.invoke("settings:update", patch),
  hideToTray: () => ipcRenderer.invoke("window:hide-to-tray"),
  onReminder: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_, payload) => handler(payload);
    ipcRenderer.on("reminder:trigger", listener);
    return () => ipcRenderer.removeListener("reminder:trigger", listener);
  }
});
