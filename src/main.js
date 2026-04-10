const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, screen } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow = null;
let bubbleWindow = null;
let centerHintWindow = null;
let tray = null;
let isQuitting = false;
let reminderTimer = null;
let bubbleDragTimer = null;
let bubbleDragOffset = null;
let bubbleDragSize = null;
let centerHintHideTimer = null;

const dataDir = app.getPath("userData");
const dataPath = path.join(dataDir, "events.json");

const defaultReminderRules = {
  day: true,
  hour: true,
  tenMin: true,
  overdue: true
};
const minBubbleSize = 32;
const maxBubbleSize = 80;
const defaultBubbleSize = 46;
const minBubbleBlinkSeconds = 0;
const maxBubbleBlinkSeconds = 3600;
const defaultBubbleBlinkSeconds = 0;
const defaultBubbleCenterHintEnabled = true;

const defaultState = {
  settings: {
    autoStart: true,
    alwaysOnTop: true,
    bubbleSize: defaultBubbleSize,
    bubbleBlinkSeconds: defaultBubbleBlinkSeconds,
    bubbleCenterHintEnabled: defaultBubbleCenterHintEnabled,
    reminders: {
      enabled: true,
      rules: { ...defaultReminderRules }
    }
  },
  events: []
};

const allowedPriorities = new Set(["urgent", "important", "daily"]);
const allowedRecurrenceFreq = new Set(["daily", "weekly", "monthly"]);

function getIconCandidates() {
  const roots = [
    path.join(__dirname, ".."),
    process.resourcesPath
  ];
  const names = [
    path.join("assets", "app.ico"),
    path.join("assets", "tray.ico"),
    path.join("assets", "tray.png"),
    "ddl.png"
  ];
  const out = [];
  for (const root of roots) {
    for (const name of names) {
      out.push(path.join(root, name));
    }
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

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
  const bubbleSizeRaw = Number(input?.bubbleSize);
  const bubbleSize = Number.isFinite(bubbleSizeRaw)
    ? Math.max(minBubbleSize, Math.min(maxBubbleSize, Math.round(bubbleSizeRaw)))
    : defaultBubbleSize;
  const bubbleBlinkRaw = Number(input?.bubbleBlinkSeconds);
  const bubbleBlinkSeconds = Number.isFinite(bubbleBlinkRaw)
    ? Math.max(minBubbleBlinkSeconds, Math.min(maxBubbleBlinkSeconds, Math.round(bubbleBlinkRaw)))
    : defaultBubbleBlinkSeconds;
  const bubbleCenterHintEnabled = input?.bubbleCenterHintEnabled !== false;
  return {
    autoStart: input?.autoStart !== false,
    alwaysOnTop: input?.alwaysOnTop !== false,
    bubbleSize,
    bubbleBlinkSeconds,
    bubbleCenterHintEnabled,
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

function normalizeTitle(value) {
  const title = String(value || "").trim();
  if (!title) {
    throw new Error("Title is required");
  }
  if (title.length > 80) {
    throw new Error("Title must be <= 80 chars");
  }
  return title;
}

function normalizePriority(value) {
  const priority = String(value || "daily").trim();
  if (!allowedPriorities.has(priority)) {
    throw new Error("Invalid priority");
  }
  return priority;
}

function normalizeDueAt(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Invalid DDL datetime");
  }
  return d.toISOString();
}

function normalizeSubtaskDueAt(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function normalizeTags(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  const uniq = new Set();
  for (const raw of source) {
    const tag = String(raw || "").trim();
    if (!tag) continue;
    uniq.add(tag.slice(0, 24));
  }
  return [...uniq].slice(0, 12);
}

function normalizeSubtasks(value) {
  const source = Array.isArray(value) ? value : [];
  const out = [];
  let idx = 0;
  for (const raw of source) {
    const text = typeof raw === "string" ? raw : raw?.text;
    const t = String(text || "").trim();
    if (!t) continue;
    const orderRaw = Number(typeof raw === "object" ? raw?.order : NaN);
    const order = Number.isFinite(orderRaw) ? Math.max(1, Math.round(orderRaw)) : idx + 1;
    out.push({
      id: typeof raw === "object" && raw?.id ? String(raw.id) : makeId("sub"),
      text: t.slice(0, 120),
      completed: Boolean(typeof raw === "object" ? raw?.completed : false),
      dueAt: typeof raw === "object" ? normalizeSubtaskDueAt(raw?.dueAt) : "",
      order,
      __idx: idx
    });
    idx += 1;
    if (out.length >= 50) break;
  }

  out.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.__idx - b.__idx;
  });

  return out.map((sub, index) => ({
    id: sub.id,
    text: sub.text,
    completed: sub.completed,
    dueAt: sub.dueAt,
    order: index + 1
  }));
}

function cloneSubtasksForNext(subtasks, freq, interval) {
  const source = normalizeSubtasks(subtasks);
  return source.map((x, index) => ({
    id: makeId("sub"),
    text: x.text,
    completed: false,
    dueAt: x.dueAt ? addDuration(x.dueAt, freq, interval) : "",
    order: index + 1
  }));
}

function normalizeRecurrence(value, fallback = null) {
  const src = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : {};
  const enabled = Boolean(src.enabled ?? base.enabled ?? false);
  const freqRaw = String(src.freq ?? base.freq ?? "daily");
  const freq = allowedRecurrenceFreq.has(freqRaw) ? freqRaw : "daily";

  const intervalNum = Number(src.interval ?? base.interval ?? 1);
  const interval = Number.isFinite(intervalNum) ? Math.max(1, Math.min(365, Math.round(intervalNum))) : 1;

  const maxRaw = Number(src.maxOccurrences ?? base.maxOccurrences ?? 0);
  const maxOccurrences = Number.isFinite(maxRaw) ? Math.max(0, Math.min(999, Math.round(maxRaw))) : 0;

  const indexRaw = Number(src.occurrenceIndex ?? base.occurrenceIndex ?? 1);
  const occurrenceIndex = Number.isFinite(indexRaw) ? Math.max(1, Math.round(indexRaw)) : 1;

  let endDate = src.endDate ?? base.endDate ?? "";
  if (endDate) {
    const d = new Date(endDate);
    endDate = Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }

  const seriesId = String(src.seriesId ?? base.seriesId ?? "").trim();

  return {
    enabled,
    freq,
    interval,
    endDate,
    maxOccurrences,
    occurrenceIndex,
    seriesId
  };
}

function normalizeEventShape(item) {
  const safeDue = (() => {
    try {
      return normalizeDueAt(item?.dueAt || "");
    } catch {
      return "";
    }
  })();

  const completed = Boolean(item?.completed);
  const completedAt = (() => {
    if (!completed) return "";
    const d = new Date(item?.completedAt || "");
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  })();

  return {
    id: String(item?.id || makeId("evt")),
    title: String(item?.title || "").trim() || "Untitled",
    note: String(item?.note || "").trim(),
    priority: allowedPriorities.has(String(item?.priority)) ? String(item.priority) : "daily",
    dueAt: safeDue,
    completed,
    completedAt,
    tags: normalizeTags(item?.tags),
    subtasks: normalizeSubtasks(item?.subtasks),
    recurrence: normalizeRecurrence(item?.recurrence),
    notifiedKeys: Array.isArray(item?.notifiedKeys) ? item.notifiedKeys.map((x) => String(x)) : [],
    createdAt: (() => {
      const d = new Date(item?.createdAt || "");
      return Number.isNaN(d.getTime()) ? nowIso() : d.toISOString();
    })(),
    updatedAt: (() => {
      const d = new Date(item?.updatedAt || "");
      return Number.isNaN(d.getTime()) ? nowIso() : d.toISOString();
    })()
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

function getPreferredNativeIcon() {
  for (const iconPath of getIconCandidates()) {
    const loaded = nativeImage.createFromPath(iconPath);
    if (!loaded.isEmpty()) return loaded;
  }
  return nativeImage.createEmpty();
}

function applyAutoStart(enabled) {
  const openAtLogin = Boolean(enabled);

  if (app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin,
      path: process.execPath,
      args: []
    });
    return;
  }

  // Dev mode: point to Electron executable and pass app folder,
  // otherwise Windows may open the default Electron app on login.
  app.setLoginItemSettings({
    openAtLogin,
    path: process.execPath,
    args: [app.getAppPath()]
  });
}

function createBubbleWindow() {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) return bubbleWindow;

  const settings = readState().settings || {};
  const bubbleSize = Number(settings.bubbleSize) || defaultBubbleSize;
  const area = screen.getPrimaryDisplay().workArea;
  const width = bubbleSize;
  const height = bubbleSize;
  const x = Math.max(area.x, area.x + area.width - width - 20);
  const y = Math.max(area.y, area.y + area.height - height - 90);

  bubbleWindow = new BrowserWindow({
    width,
    height,
    minWidth: width,
    minHeight: height,
    maxWidth: width,
    maxHeight: height,
    useContentSize: true,
    x,
    y,
    frame: false,
    thickFrame: false,
    transparent: true,
    resizable: false,
    movable: false,
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
  bubbleWindow.setMinimumSize(width, height);
  bubbleWindow.setMaximumSize(width, height);
  bubbleWindow.setResizable(false);
  bubbleWindow.on("will-resize", (event) => {
    event.preventDefault();
  });
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

function syncBubbleSettingsToRenderer(settings) {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return;
  try {
    bubbleWindow.webContents.send("bubble:settings", {
      bubbleBlinkSeconds: Number(settings?.bubbleBlinkSeconds) || 0,
      bubbleCenterHintEnabled: settings?.bubbleCenterHintEnabled !== false
    });
  } catch {
    // ignore renderer sync errors
  }
}

function createCenterHintWindow() {
  if (centerHintWindow && !centerHintWindow.isDestroyed()) return centerHintWindow;
  const area = screen.getPrimaryDisplay().workArea;
  const width = 420;
  const height = 90;
  const x = Math.round(area.x + (area.width - width) / 2);
  const y = Math.round(area.y + (area.height - height) / 2);

  centerHintWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    thickFrame: false,
    webPreferences: {
      preload: path.join(__dirname, "center-hint-preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  centerHintWindow.setIgnoreMouseEvents(true);
  centerHintWindow.setAlwaysOnTop(true, "screen-saver");
  centerHintWindow.loadFile(path.join(__dirname, "center-hint.html"));
  centerHintWindow.on("closed", () => {
    centerHintWindow = null;
    if (centerHintHideTimer) {
      clearTimeout(centerHintHideTimer);
      centerHintHideTimer = null;
    }
  });
  return centerHintWindow;
}

function showCenterHint(message) {
  const text = String(message || "").trim() || "请检查一下你的事件安排";
  const win = createCenterHintWindow();
  const send = () => {
    try {
      win.webContents.send("center-hint:show", text);
    } catch {
      // ignore
    }
  };
  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", send);
  } else {
    send();
  }
  win.showInactive();
  if (centerHintHideTimer) {
    clearTimeout(centerHintHideTimer);
    centerHintHideTimer = null;
  }
  centerHintHideTimer = setTimeout(() => {
    if (centerHintWindow && !centerHintWindow.isDestroyed()) {
      centerHintWindow.hide();
    }
  }, 1400);
}

function applyBubbleWindowSize(size) {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return;
  const target = Math.max(minBubbleSize, Math.min(maxBubbleSize, Math.round(Number(size) || defaultBubbleSize)));
  const bounds = bubbleWindow.getBounds();
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  const area = display.workArea;

  const nextX = Math.min(Math.max(bounds.x, area.x), area.x + area.width - target);
  const nextY = Math.min(Math.max(bounds.y, area.y), area.y + area.height - target);
  bubbleWindow.setMinimumSize(target, target);
  bubbleWindow.setMaximumSize(target, target);
  bubbleWindow.setResizable(false);
  bubbleWindow.setBounds({
    x: Math.round(nextX),
    y: Math.round(nextY),
    width: target,
    height: target
  });
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
  bubbleDragSize = null;
}

function startBubbleDrag(startPoint) {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return false;

  const startX = Number(startPoint?.x);
  const startY = Number(startPoint?.y);
  if (!Number.isFinite(startX) || !Number.isFinite(startY)) return false;

  const bounds = bubbleWindow.getBounds();
  const currentSettings = readState().settings || {};
  const targetSize = Math.max(minBubbleSize, Math.min(maxBubbleSize, Math.round(Number(currentSettings.bubbleSize) || defaultBubbleSize)));
  bubbleWindow.setMinimumSize(targetSize, targetSize);
  bubbleWindow.setMaximumSize(targetSize, targetSize);
  bubbleWindow.setResizable(false);
  bubbleDragOffset = {
    x: startX - bounds.x,
    y: startY - bounds.y
  };
  bubbleDragSize = {
    width: targetSize,
    height: targetSize
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
    const width = Math.max(minBubbleSize, Math.min(maxBubbleSize, Math.round(Number(bubbleDragSize?.width) || defaultBubbleSize)));
    const height = Math.max(minBubbleSize, Math.min(maxBubbleSize, Math.round(Number(bubbleDragSize?.height) || defaultBubbleSize)));
    bubbleWindow.setBounds({
      x: Math.round(cursor.x - bubbleDragOffset.x),
      y: Math.round(cursor.y - bubbleDragOffset.y),
      width,
      height
    });
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
    { label: "Show Main Window", click: () => showMainWindow() },
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
    height: 740,
    minWidth: 820,
    minHeight: 600,
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
    showBubbleWindow();
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
    // ignore
  }

  if (tray && process.platform === "win32") {
    try {
      tray.displayBalloon({
        iconType: "info",
        title,
        content: body
      });
    } catch {
      // ignore
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send("reminder:trigger", {
        title,
        body,
        at: nowIso()
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
      // ignore
    }
  }

  console.log(`[reminder] ${title}: ${body}`);
}

function addDuration(dateLike, freq, interval) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return "";
  if (freq === "weekly") {
    d.setDate(d.getDate() + 7 * interval);
  } else if (freq === "monthly") {
    d.setMonth(d.getMonth() + interval);
  } else {
    d.setDate(d.getDate() + interval);
  }
  return d.toISOString();
}

function maybeGenerateRecurringNext(state, prevEvent, nextEvent) {
  const justCompleted = !prevEvent.completed && nextEvent.completed;
  if (!justCompleted) return;

  const rec = normalizeRecurrence(nextEvent.recurrence);
  if (!rec.enabled) return;
  if (!nextEvent.dueAt) return;

  const currentIndex = Number(rec.occurrenceIndex || 1);
  const nextIndex = currentIndex + 1;

  if (rec.maxOccurrences > 0 && nextIndex > rec.maxOccurrences) {
    return;
  }

  const nextDueAt = addDuration(nextEvent.dueAt, rec.freq, rec.interval);
  if (!nextDueAt) return;

  if (rec.endDate) {
    const endMs = new Date(rec.endDate).getTime();
    const nextMs = new Date(nextDueAt).getTime();
    if (Number.isFinite(endMs) && Number.isFinite(nextMs) && nextMs > endMs) {
      return;
    }
  }

  const seriesId = rec.seriesId || nextEvent.id;
  const exists = state.events.some((x) => x.recurrence?.seriesId === seriesId && x.recurrence?.occurrenceIndex === nextIndex);
  if (exists) return;

  const next = {
    id: makeId("evt"),
    title: nextEvent.title,
    note: nextEvent.note,
    priority: nextEvent.priority,
    dueAt: nextDueAt,
    completed: false,
    completedAt: "",
    tags: [...(nextEvent.tags || [])],
    subtasks: cloneSubtasksForNext(nextEvent.subtasks || [], rec.freq, rec.interval),
    recurrence: {
      ...rec,
      enabled: true,
      seriesId,
      occurrenceIndex: nextIndex
    },
    notifiedKeys: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  nextEvent.recurrence = {
    ...rec,
    enabled: true,
    seriesId,
    occurrenceIndex: currentIndex
  };

  state.events.push(next);
}

function spawnRecurringNextForOverdue(state, item, nowMs) {
  if (!item || item.completed || !item.dueAt) return false;

  const rec = normalizeRecurrence(item.recurrence);
  if (!rec.enabled) return false;

  const dueMs = new Date(item.dueAt).getTime();
  if (!Number.isFinite(dueMs) || dueMs > nowMs) return false;

  const currentIndex = Math.max(1, Number(rec.occurrenceIndex || 1));
  const nextIndex = currentIndex + 1;
  if (rec.maxOccurrences > 0 && nextIndex > rec.maxOccurrences) return false;

  const nextDueAt = addDuration(item.dueAt, rec.freq, rec.interval);
  if (!nextDueAt) return false;

  if (rec.endDate) {
    const endMs = new Date(rec.endDate).getTime();
    const nextMs = new Date(nextDueAt).getTime();
    if (Number.isFinite(endMs) && Number.isFinite(nextMs) && nextMs > endMs) return false;
  }

  const seriesId = rec.seriesId || item.id;
  const exists = state.events.some((x) => x.recurrence?.seriesId === seriesId && x.recurrence?.occurrenceIndex === nextIndex);
  if (exists) return false;

  item.recurrence = {
    ...rec,
    enabled: true,
    seriesId,
    occurrenceIndex: currentIndex
  };
  item.updatedAt = nowIso();

  const next = {
    id: makeId("evt"),
    title: item.title,
    note: item.note,
    priority: item.priority,
    dueAt: nextDueAt,
    completed: false,
    completedAt: "",
    tags: [...(item.tags || [])],
    subtasks: cloneSubtasksForNext(item.subtasks || [], rec.freq, rec.interval),
    recurrence: {
      ...rec,
      enabled: true,
      seriesId,
      occurrenceIndex: nextIndex
    },
    notifiedKeys: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  state.events.push(next);
  return true;
}

function runReminderCheck() {
  const state = readState();
  const reminders = state.settings?.reminders || defaultState.settings.reminders;
  if (reminders.enabled === false) return;

  const rules = getReminderRules(reminders);
  const now = Date.now();
  let changed = false;

  for (const item of [...state.events]) {
    if (item.completed || !item.dueAt) continue;

    if (spawnRecurringNextForOverdue(state, item, now)) {
      changed = true;
    }

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

      if (now >= triggerMs && !item.notifiedKeys.includes(rule.key)) {
        sendDesktopNotification("Reminder", `${item.title}\n${rule.label}, due: ${new Date(item.dueAt).toLocaleString()}`);
        item.notifiedKeys.push(rule.key);
        changed = true;
      }
    }

    if (reminders.rules?.overdue !== false) {
      const overdueKey = "overdue";
      if (now > dueMs && !item.notifiedKeys.includes(overdueKey)) {
        sendDesktopNotification("Task overdue", `${item.title}\nDue: ${new Date(item.dueAt).toLocaleString()}`);
        item.notifiedKeys.push(overdueKey);
        changed = true;
      }
    }
  }

  if (changed) writeState(state);
}

function startReminderLoop() {
  if (reminderTimer) clearInterval(reminderTimer);
  runReminderCheck();
  reminderTimer = setInterval(runReminderCheck, 30 * 1000);
}

ipcMain.handle("events:list", () => readState().events);

ipcMain.handle("events:add", (_, input) => {
  const state = readState();
  const now = nowIso();
  const id = makeId("evt");
  const recurrence = normalizeRecurrence(input?.recurrence);
  const record = {
    id,
    title: normalizeTitle(input?.title),
    note: String(input?.note || "").trim(),
    priority: normalizePriority(input?.priority),
    dueAt: normalizeDueAt(input?.dueAt),
    completed: false,
    completedAt: "",
    tags: normalizeTags(input?.tags),
    subtasks: normalizeSubtasks(input?.subtasks),
    recurrence: {
      ...recurrence,
      seriesId: recurrence.enabled ? recurrence.seriesId || id : "",
      occurrenceIndex: recurrence.enabled ? Math.max(1, recurrence.occurrenceIndex || 1) : 1
    },
    notifiedKeys: [],
    createdAt: now,
    updatedAt: now
  };

  state.events.push(record);
  writeState(state);
  return record;
});

ipcMain.handle("events:update", (_, input) => {
  const state = readState();
  const index = state.events.findIndex((x) => x.id === input?.id);
  if (index === -1) throw new Error("Event not found");

  const old = state.events[index];
  const nextDueAt = normalizeDueAt(input?.dueAt ?? old.dueAt);
  const nextCompleted = typeof input?.completed === "boolean" ? input.completed : old.completed;
  const nextRecurrence = normalizeRecurrence(input?.recurrence, old.recurrence);

  const next = {
    ...old,
    title: normalizeTitle(input?.title ?? old.title),
    note: String(input?.note ?? old.note).trim(),
    priority: normalizePriority(input?.priority ?? old.priority),
    dueAt: nextDueAt,
    completed: nextCompleted,
    completedAt: nextCompleted ? (old.completed ? old.completedAt || nowIso() : nowIso()) : "",
    tags: normalizeTags(input?.tags ?? old.tags),
    subtasks: normalizeSubtasks(input?.subtasks ?? old.subtasks),
    recurrence: {
      ...nextRecurrence,
      seriesId: nextRecurrence.enabled
        ? nextRecurrence.seriesId || old.recurrence?.seriesId || old.id
        : "",
      occurrenceIndex: nextRecurrence.enabled
        ? Math.max(1, Number(nextRecurrence.occurrenceIndex || old.recurrence?.occurrenceIndex || 1))
        : 1
    },
    updatedAt: nowIso()
  };

  if (old.dueAt !== nextDueAt) {
    next.notifiedKeys = [];
  }
  if (!Array.isArray(next.notifiedKeys)) {
    next.notifiedKeys = [];
  }

  state.events[index] = next;
  maybeGenerateRecurringNext(state, old, state.events[index]);
  writeState(state);
  return state.events[index];
});

ipcMain.handle("events:toggle", (_, id) => {
  const state = readState();
  const index = state.events.findIndex((x) => x.id === id);
  if (index === -1) throw new Error("Event not found");

  const old = state.events[index];
  const next = {
    ...old,
    completed: !old.completed,
    completedAt: !old.completed ? nowIso() : "",
    updatedAt: nowIso()
  };

  state.events[index] = next;
  maybeGenerateRecurringNext(state, old, state.events[index]);
  writeState(state);
  return state.events[index];
});

ipcMain.handle("events:delete", (_, id) => {
  const state = readState();
  state.events = state.events.filter((x) => x.id !== id);
  writeState(state);
  return true;
});

ipcMain.handle("events:get-urgent-count", () => {
  const state = readState();
  return state.events.filter((x) => x.priority === "urgent" && !x.completed).length;
});

ipcMain.handle("settings:get", () => readState().settings);

ipcMain.handle("settings:update", (_, patch) => {
  const state = readState();
  const prev = state.settings;
  const merged = {
    ...prev,
    ...(patch || {}),
    reminders: {
      ...(prev.reminders || {}),
      ...(patch?.reminders || {}),
      rules: {
        ...(prev.reminders?.rules || {}),
        ...(patch?.reminders?.rules || {})
      }
    }
  };
  state.settings = normalizeSettings(merged);

  writeState(state);

  if (Object.prototype.hasOwnProperty.call(patch || {}, "autoStart")) {
    applyAutoStart(state.settings.autoStart);
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, "alwaysOnTop") && mainWindow) {
    mainWindow.setAlwaysOnTop(Boolean(state.settings.alwaysOnTop), "screen-saver");
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, "bubbleSize")) {
    applyBubbleWindowSize(state.settings.bubbleSize);
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, "bubbleBlinkSeconds")) {
    syncBubbleSettingsToRenderer(state.settings);
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, "bubbleCenterHintEnabled")) {
    syncBubbleSettingsToRenderer(state.settings);
  }

  return state.settings;
});

ipcMain.handle("window:hide-to-tray", () => {
  hideBubbleWindow();
  if (mainWindow) mainWindow.hide();
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

ipcMain.handle("window:show-center-hint", (_, text) => {
  showCenterHint(text);
  return true;
});

ipcMain.handle("window:start-bubble-drag", (_, point) => startBubbleDrag(point));
ipcMain.handle("window:end-bubble-drag", () => {
  stopBubbleDrag();
  return true;
});

ipcMain.handle("window:show-bubble-menu", () => {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return false;

  const menu = Menu.buildFromTemplate([
    { label: "Show Main Window", click: () => showMainWindow() },
    { label: "Hide Bubble", click: () => hideBubbleWindow() },
    { type: "separator" },
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
  if (centerHintHideTimer) {
    clearTimeout(centerHintHideTimer);
    centerHintHideTimer = null;
  }
  if (centerHintWindow && !centerHintWindow.isDestroyed()) {
    centerHintWindow.destroy();
    centerHintWindow = null;
  }
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
});

app.on("window-all-closed", () => {
  // keep process alive in tray unless user quits
});
