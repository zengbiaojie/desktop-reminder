const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, screen } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow = null;
let bubbleWindow = null;
let tray = null;
let isQuitting = false;
let reminderTimer = null;
let bubbleDragTimer = null;
let bubbleDragOffset = null;

const dataDir = app.getPath("userData");
const dataPath = path.join(dataDir, "events.json");

const defaultReminderRules = {
  day: true,
  hour: true,
  tenMin: true,
  overdue: true
};

const defaultState = {
  settings: {
    autoStart: true,
    alwaysOnTop: true,
    reminders: {
      enabled: true,
      rules: { ...defaultReminderRules }
    }
  },
  events: []
};

const allowedPriorities = new Set(["urgent", "important", "daily"]);
const iconCandidates = [
  path.join(__dirname, "..", "assets", "tray.ico"),
  path.join(__dirname, "..", "assets", "tray.png"),
  path.join(__dirname, "..", "ddl.png")
];

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(dataPath)) {
    fs.writeFileSync(dataPath, JSON.stringify(defaultState, null, 2), "utf-8");
  }
}

function normalizeSettings(input) {
  const reminders = input?.reminders || {};
  return {
    autoStart: input?.autoStart !== false,
    alwaysOnTop: input?.alwaysOnTop !== false,
    reminders: {
      enabled: reminders.enabled !== false,
      rules: {
        day: reminders.rules?.day !== false,
        hour: reminders.rules?.hour !== false,
        tenMin: reminders.rules?.tenMin !== false,
        overdue: reminders.rules?.overdue !== false
      }
    }
  };
}

function normalizeEventShape(item) {
  return {
    ...item,
    notifiedKeys: Array.isArray(item?.notifiedKeys) ? item.notifiedKeys : []
  };
}

function readState() {
  ensureDataFile();
  try {
    const text = fs.readFileSync(dataPath, "utf-8");
    const parsed = JSON.parse(text);
    return {
      settings: normalizeSettings(parsed.settings || defaultState.settings),
      events: Array.isArray(parsed.events) ? parsed.events.map((x) => normalizeEventShape(x)) : []
    };
  } catch {
    return {
      settings: normalizeSettings(defaultState.settings),
      events: []
    };
  }
}

function writeState(state) {
  fs.writeFileSync(dataPath, JSON.stringify(state, null, 2), "utf-8");
}

function normalizeTitle(value) {
  const title = String(value || "").trim();
  if (!title) throw new Error("Title is required");
  if (title.length > 80) throw new Error("Title must be <= 80 chars");
  return title;
}

function normalizePriority(value) {
  const priority = String(value || "daily");
  if (!allowedPriorities.has(priority)) {
    throw new Error("Invalid priority");
  }
  return priority;
}

function normalizeDueAt(value) {
  if (!value) return "";
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) {
    throw new Error("Invalid DDL datetime format");
  }
  return due.toISOString();
}

function getPreferredNativeIcon() {
  for (const iconPath of iconCandidates) {
    const loaded = nativeImage.createFromPath(iconPath);
    if (!loaded.isEmpty()) return loaded;
  }
  return nativeImage.createEmpty();
}

function applyAutoStart(enabled) {
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    path: process.execPath,
    args: []
  });
}

function createBubbleWindow() {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    return bubbleWindow;
  }

  const area = screen.getPrimaryDisplay().workArea;
  const width = 72;
  const height = 72;
  const x = Math.max(area.x, area.x + area.width - width - 20);
  const y = Math.max(area.y, area.y + area.height - height - 90);

  bubbleWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "bubble-preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  bubbleWindow.setAlwaysOnTop(true, "screen-saver");
  bubbleWindow.loadFile(path.join(__dirname, "bubble.html"));

  bubbleWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    bubbleWindow.hide();
  });

  return bubbleWindow;
}

function showBubbleWindow() {
  const win = createBubbleWindow();
  win.show();
}

function hideBubbleWindow() {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.hide();
  }
}

function stopBubbleDrag() {
  if (bubbleDragTimer) {
    clearInterval(bubbleDragTimer);
    bubbleDragTimer = null;
  }
  bubbleDragOffset = null;
}

function startBubbleDrag(startPoint) {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) {
    return false;
  }
  const startX = Number(startPoint?.x);
  const startY = Number(startPoint?.y);
  if (!Number.isFinite(startX) || !Number.isFinite(startY)) {
    return false;
  }

  const bounds = bubbleWindow.getBounds();
  bubbleDragOffset = {
    x: startX - bounds.x,
    y: startY - bounds.y
  };

  if (bubbleDragTimer) {
    clearInterval(bubbleDragTimer);
  }

  bubbleDragTimer = setInterval(() => {
    if (!bubbleWindow || bubbleWindow.isDestroyed() || !bubbleDragOffset) {
      stopBubbleDrag();
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    bubbleWindow.setPosition(
      Math.round(cursor.x - bubbleDragOffset.x),
      Math.round(cursor.y - bubbleDragOffset.y)
    );
  }, 8);

  return true;
}

function showMainWindow() {
  if (!mainWindow) return;
  hideBubbleWindow();
  mainWindow.show();
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
}

function createTray() {
  let icon = getPreferredNativeIcon();
  if (icon.isEmpty()) {
    const iconSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="14" fill="#22577A"/>
    <circle cx="32" cy="32" r="18" fill="#57CC99"/>
    <path d="M23 33l6 6 13-13" stroke="#0B132B" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
    icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(iconSvg).toString("base64")}`);
  }

  tray = new Tray(icon.resize({ width: 16, height: 16, quality: "best" }));
  tray.setToolTip("Desktop Reminder");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Main Window",
      click: () => showMainWindow()
    },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on("click", () => {
    if (mainWindow && mainWindow.isVisible()) {
      hideBubbleWindow();
      mainWindow.hide();
    } else {
      showMainWindow();
    }
  });
}

function createWindow() {
  const state = readState();
  applyAutoStart(state.settings.autoStart);
  const windowIcon = getPreferredNativeIcon();

  mainWindow = new BrowserWindow({
    width: 980,
    height: 700,
    minWidth: 780,
    minHeight: 560,
    title: "Desktop Reminder",
    icon: windowIcon.isEmpty() ? undefined : windowIcon,
    backgroundColor: "#f6f9fc",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setAlwaysOnTop(Boolean(state.settings.alwaysOnTop), "screen-saver");
  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    hideBubbleWindow();
    mainWindow.hide();
  });

  mainWindow.on("minimize", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
    showBubbleWindow();
  });
}

function getReminderRules(reminders) {
  const rules = reminders?.rules || defaultReminderRules;
  const result = [];
  if (rules.day) result.push({ key: "day", minutes: 1440, label: "DDL in 1 day" });
  if (rules.hour) result.push({ key: "hour", minutes: 60, label: "DDL in 1 hour" });
  if (rules.tenMin) result.push({ key: "tenMin", minutes: 10, label: "DDL in 10 minutes" });
  return result;
}

function sendDesktopNotification(title, body) {
  try {
    if (Notification.isSupported()) {
      const icon = getPreferredNativeIcon();
      const notice = new Notification({
        title,
        body,
        icon: icon.isEmpty() ? undefined : icon,
        silent: false
      });
      notice.show();
    }
  } catch {
    // ignore notification runtime errors
  }

  if (tray && process.platform === "win32") {
    try {
      tray.displayBalloon({
        iconType: "info",
        title,
        content: body
      });
    } catch {
      // ignore tray balloon errors
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send("reminder:trigger", {
        title,
        body,
        at: new Date().toISOString()
      });
      if (!mainWindow.isVisible()) {
        showMainWindow();
      }
      mainWindow.flashFrame(true);
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.flashFrame(false);
        }
      }, 6000);
    } catch {
      // ignore window notification errors
    }
  }

  console.log(`[reminder] ${title}: ${body}`);
}

function runReminderCheck() {
  const state = readState();
  const reminders = state.settings?.reminders || defaultState.settings.reminders;
  if (reminders.enabled === false) return;

  const rules = getReminderRules(reminders);
  const now = Date.now();
  let changed = false;

  for (const item of state.events) {
    if (item.completed || !item.dueAt) continue;

    const dueMs = new Date(item.dueAt).getTime();
    if (Number.isNaN(dueMs)) continue;

    if (!Array.isArray(item.notifiedKeys)) {
      item.notifiedKeys = [];
      changed = true;
    }

    for (const rule of rules) {
      const triggerMs = dueMs - rule.minutes * 60 * 1000;
      const createdMs = new Date(item.createdAt || "").getTime();
      if (Number.isFinite(createdMs) && createdMs > triggerMs) {
        if (!item.notifiedKeys.includes(rule.key)) {
          item.notifiedKeys.push(rule.key);
          changed = true;
        }
        continue;
      }

      const shouldNotify = now >= triggerMs;
      if (!shouldNotify || item.notifiedKeys.includes(rule.key)) continue;

      sendDesktopNotification("Reminder", `${item.title}\n${rule.label}, due: ${new Date(item.dueAt).toLocaleString()}`);
      item.notifiedKeys.push(rule.key);
      changed = true;
    }

    if (reminders.rules?.overdue !== false) {
      const overdueKey = "overdue";
      const shouldNotifyOverdue = now > dueMs;
      if (shouldNotifyOverdue && !item.notifiedKeys.includes(overdueKey)) {
        sendDesktopNotification("Task overdue", `${item.title}\nDue: ${new Date(item.dueAt).toLocaleString()}`);
        item.notifiedKeys.push(overdueKey);
        changed = true;
      }
    }
  }

  if (changed) {
    writeState(state);
  }
}

function startReminderLoop() {
  if (reminderTimer) clearInterval(reminderTimer);
  runReminderCheck();
  reminderTimer = setInterval(() => {
    runReminderCheck();
  }, 30 * 1000);
}

ipcMain.handle("events:list", () => readState().events);

ipcMain.handle("events:add", (_, input) => {
  const state = readState();
  const record = {
    id: `evt_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    title: normalizeTitle(input.title),
    note: String(input.note || "").trim(),
    priority: normalizePriority(input.priority),
    dueAt: normalizeDueAt(input.dueAt),
    notifiedKeys: [],
    completed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  state.events.push(record);
  writeState(state);
  return record;
});

ipcMain.handle("events:update", (_, input) => {
  const state = readState();
  const index = state.events.findIndex((x) => x.id === input.id);
  if (index === -1) throw new Error("Event not found");

  const old = state.events[index];
  const nextDueAt = normalizeDueAt(input.dueAt ?? old.dueAt);
  const next = {
    ...old,
    title: normalizeTitle(input.title ?? old.title),
    note: String(input.note ?? old.note).trim(),
    priority: normalizePriority(input.priority ?? old.priority),
    dueAt: nextDueAt,
    completed: typeof input.completed === "boolean" ? input.completed : old.completed,
    updatedAt: new Date().toISOString()
  };

  if (old.dueAt !== nextDueAt) {
    next.notifiedKeys = [];
  }
  if (!Array.isArray(next.notifiedKeys)) {
    next.notifiedKeys = [];
  }

  state.events[index] = next;
  writeState(state);
  return next;
});

ipcMain.handle("events:toggle", (_, id) => {
  const state = readState();
  const index = state.events.findIndex((x) => x.id === id);
  if (index === -1) throw new Error("Event not found");

  state.events[index].completed = !state.events[index].completed;
  state.events[index].updatedAt = new Date().toISOString();
  writeState(state);
  return state.events[index];
});

ipcMain.handle("events:delete", (_, id) => {
  const state = readState();
  state.events = state.events.filter((x) => x.id !== id);
  writeState(state);
  return true;
});

ipcMain.handle("settings:get", () => readState().settings);

ipcMain.handle("settings:update", (_, patch) => {
  const state = readState();
  const prev = state.settings;

  const nextReminders = normalizeSettings({
    ...prev,
    reminders: {
      ...(prev.reminders || {}),
      ...(patch.reminders || {}),
      rules: {
        ...(prev.reminders?.rules || {}),
        ...(patch.reminders?.rules || {})
      }
    }
  }).reminders;

  state.settings = {
    ...prev,
    ...patch,
    reminders: nextReminders
  };

  writeState(state);

  if (Object.prototype.hasOwnProperty.call(patch, "autoStart")) {
    applyAutoStart(state.settings.autoStart);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "alwaysOnTop") && mainWindow) {
    mainWindow.setAlwaysOnTop(Boolean(state.settings.alwaysOnTop), "screen-saver");
  }

  return state.settings;
});

ipcMain.handle("window:hide-to-tray", () => {
  hideBubbleWindow();
  if (mainWindow) {
    mainWindow.hide();
  }
  return true;
});

ipcMain.handle("window:restore-from-bubble", () => {
  showMainWindow();
  return true;
});

ipcMain.handle("window:hide-bubble", () => {
  hideBubbleWindow();
  return true;
});

ipcMain.handle("window:start-bubble-drag", (_, point) => {
  return startBubbleDrag(point);
});

ipcMain.handle("window:end-bubble-drag", () => {
  stopBubbleDrag();
  return true;
});

ipcMain.handle("window:show-bubble-menu", () => {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) {
    return false;
  }

  const menu = Menu.buildFromTemplate([
    {
      label: "Show Main Window",
      click: () => showMainWindow()
    },
    {
      label: "Hide Bubble",
      click: () => hideBubbleWindow()
    },
    {
      type: "separator"
    },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  menu.popup({ window: bubbleWindow });
  return true;
});

ipcMain.handle("events:get-urgent-count", () => {
  const state = readState();
  return state.events.filter((x) => x.priority === "urgent" && !x.completed).length;
});

app.whenReady().then(() => {
  app.setAppUserModelId("desktop-reminder.app");
  createWindow();
  createBubbleWindow();
  hideBubbleWindow();
  createTray();
  startReminderLoop();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
    showMainWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  stopBubbleDrag();
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
});

app.on("window-all-closed", () => {
  // Keep process alive in tray unless user quits.
});
