const state = {
  events: [],
  currentView: "list",
  formSubtasks: [],
  filters: {
    keyword: "",
    priority: "all",
    status: "all",
    tag: ""
  },
  settings: {
    autoStart: true,
    alwaysOnTop: true,
    reminders: {
      enabled: true,
      rules: {
        day: true,
        hour: true,
        tenMin: true,
        overdue: true
      }
    }
  }
};

const els = {
  inAppReminder: document.getElementById("inAppReminder"),
  form: document.getElementById("eventForm"),
  formTitle: document.getElementById("formTitle"),
  creatorOverlay: document.getElementById("creatorOverlay"),
  creatorPanel: document.getElementById("creatorPanel"),
  openCreatorBtn: document.getElementById("openCreatorBtn"),
  closeCreatorBtn: document.getElementById("closeCreatorBtn"),
  id: document.getElementById("eventId"),
  title: document.getElementById("title"),
  note: document.getElementById("note"),
  priority: document.getElementById("priority"),
  dueAt: document.getElementById("dueAt"),
  tags: document.getElementById("tags"),
  recurrenceEnabled: document.getElementById("recurrenceEnabled"),
  recurrenceFreq: document.getElementById("recurrenceFreq"),
  recurrenceInterval: document.getElementById("recurrenceInterval"),
  recurrenceEndDate: document.getElementById("recurrenceEndDate"),
  recurrenceMaxOccurrences: document.getElementById("recurrenceMaxOccurrences"),
  subtaskInput: document.getElementById("subtaskInput"),
  addSubtaskBtn: document.getElementById("addSubtaskBtn"),
  subtaskList: document.getElementById("subtaskList"),
  saveBtn: document.getElementById("saveBtn"),
  cancelEdit: document.getElementById("cancelEdit"),
  statsPanel: document.getElementById("statsPanel"),
  workspaceTabs: document.getElementById("workspaceTabs"),
  viewTabs: document.getElementById("viewTabs"),
  viewContent: document.getElementById("viewContent"),
  todayPanel: document.getElementById("todayPanel"),
  reminderEnabled: document.getElementById("reminderEnabled"),
  reminderDay: document.getElementById("reminderDay"),
  reminderHour: document.getElementById("reminderHour"),
  reminderTenMin: document.getElementById("reminderTenMin"),
  reminderOverdue: document.getElementById("reminderOverdue"),
  resultStat: document.getElementById("resultStat"),
  searchKeyword: document.getElementById("searchKeyword"),
  filterPriority: document.getElementById("filterPriority"),
  filterStatus: document.getElementById("filterStatus"),
  filterTag: document.getElementById("filterTag"),
  autoStart: document.getElementById("autoStart"),
  alwaysOnTop: document.getElementById("alwaysOnTop"),
  emptyTemplate: document.getElementById("emptyTemplate")
};

let reminderBannerTimer = null;

function setCreatorOpen(open) {
  if (!els.creatorOverlay) return;
  els.creatorOverlay.classList.toggle("hidden", !open);
}

const priorityLabel = {
  urgent: "紧急",
  important: "重要",
  daily: "日常"
};

const pad = (n) => String(n).padStart(2, "0");

function normalizeDate(dateLike) {
  if (!dateLike) return "";
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtDateTime(dateLike) {
  if (!dateLike) return "未设置";
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return "未设置";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toLocalInputValue(dateLike) {
  if (!dateLike) return "";
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isOverdue(item) {
  if (!item.dueAt || item.completed) return false;
  const due = new Date(item.dueAt).getTime();
  return Number.isFinite(due) && due < Date.now();
}

function getEventStatus(item) {
  if (isOverdue(item)) return "overdue";
  if (item.completed) return "completed";
  return "active";
}

function getEventStatusLabel(item) {
  const status = getEventStatus(item);
  if (status === "overdue") return "已逾期";
  if (status === "completed") return "已完成";
  return "进行中";
}

function esc(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sortedEvents(events) {
  return [...events].sort((a, b) => {
    const aCompleted = Boolean(a.completed);
    const bCompleted = Boolean(b.completed);
    if (aCompleted !== bCompleted) return aCompleted ? 1 : -1;

    const taRaw = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const tbRaw = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const ta = Number.isFinite(taRaw) ? taRaw : Number.POSITIVE_INFINITY;
    const tb = Number.isFinite(tbRaw) ? tbRaw : Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;

    // Tertiary order for equal deadlines: recently updated first.
    const ua = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const ub = new Date(b.updatedAt || b.createdAt || 0).getTime();
    if (ua !== ub) return ub - ua;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}

function parseTags(input) {
  return String(input || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function filteredEvents() {
  const keyword = state.filters.keyword.toLowerCase().trim();
  const tag = state.filters.tag.trim();

  return sortedEvents(state.events).filter((item) => {
    if (state.filters.priority !== "all" && item.priority !== state.filters.priority) return false;
    if (state.filters.status === "active" && (item.completed || isOverdue(item))) return false;
    if (state.filters.status === "completed" && !item.completed) return false;
    if (state.filters.status === "overdue" && !isOverdue(item)) return false;

    if (tag) {
      const tags = Array.isArray(item.tags) ? item.tags : [];
      if (!tags.includes(tag)) return false;
    }

    if (!keyword) return true;
    const text = `${item.title || ""} ${item.note || ""} ${(item.tags || []).join(" ")}`.toLowerCase();
    return text.includes(keyword);
  });
}

function subtaskProgress(item) {
  const subtasks = Array.isArray(item.subtasks) ? item.subtasks : [];
  if (!subtasks.length) return "无子任务";
  const done = subtasks.filter((x) => x.completed).length;
  return `${done}/${subtasks.length}`;
}

function updateResultStat(visibleEvents) {
  els.resultStat.textContent = `当前显示 ${visibleEvents.length} 条`;
}

function renderSubtaskEditor() {
  if (!state.formSubtasks.length) {
    els.subtaskList.innerHTML = '<div class="today-item"><small>暂无子任务</small></div>';
    return;
  }

  els.subtaskList.innerHTML = state.formSubtasks.map((sub) => `
    <label class="subtask-row ${sub.completed ? "done" : ""}">
      <input type="checkbox" data-action="toggle-subtask" data-id="${esc(sub.id)}" ${sub.completed ? "checked" : ""} />
      <span>${esc(sub.text)}</span>
      <button type="button" class="danger" data-action="delete-subtask" data-id="${esc(sub.id)}">删除</button>
    </label>
  `).join("");
}

function resetForm() {
  els.id.value = "";
  els.title.value = "";
  els.note.value = "";
  els.priority.value = "daily";
  els.dueAt.value = "";
  els.tags.value = "";
  els.recurrenceEnabled.checked = false;
  els.recurrenceFreq.value = "daily";
  els.recurrenceInterval.value = "1";
  els.recurrenceEndDate.value = "";
  els.recurrenceMaxOccurrences.value = "0";
  state.formSubtasks = [];
  renderSubtaskEditor();
  els.formTitle.textContent = "新增事件";
  els.saveBtn.textContent = "保存事件";
  els.cancelEdit.classList.add("hidden");
}

function startEdit(item) {
  els.id.value = item.id;
  els.title.value = item.title || "";
  els.note.value = item.note || "";
  els.priority.value = item.priority || "daily";
  els.dueAt.value = toLocalInputValue(item.dueAt);
  els.tags.value = (item.tags || []).join(", ");

  const rec = item.recurrence || {};
  els.recurrenceEnabled.checked = Boolean(rec.enabled);
  els.recurrenceFreq.value = rec.freq || "daily";
  els.recurrenceInterval.value = String(rec.interval || 1);
  els.recurrenceEndDate.value = rec.endDate ? normalizeDate(rec.endDate) : "";
  els.recurrenceMaxOccurrences.value = String(rec.maxOccurrences || 0);

  state.formSubtasks = Array.isArray(item.subtasks)
    ? item.subtasks.map((x) => ({ id: x.id || `sub_${Math.random()}`, text: x.text || "", completed: Boolean(x.completed) }))
    : [];
  renderSubtaskEditor();

  els.formTitle.textContent = "编辑事件";
  els.saveBtn.textContent = "更新事件";
  els.cancelEdit.classList.remove("hidden");
  setCreatorOpen(true);
}

function recurrenceLabel(rec) {
  if (!rec || !rec.enabled) return "非重复";
  const freqMap = { daily: "每天", weekly: "每周", monthly: "每月" };
  return `${freqMap[rec.freq] || "每天"} × ${rec.interval || 1}`;
}

function renderList(events) {
  const html = events.map((item) => `
    <article class="card ${esc(item.priority)} ${item.completed ? "completed" : ""} ${isOverdue(item) ? "overdue" : ""}">
      <div class="card-main">
        <h3>${esc(item.title)}</h3>
        <p>${esc(item.note || "无备注")}</p>
        <div class="meta">
          <span class="tag">${priorityLabel[item.priority] || "日常"}</span>
          <span class="tag ${isOverdue(item) ? "due-overdue" : ""}">DDL: ${esc(fmtDateTime(item.dueAt))}</span>
          <span class="tag ${isOverdue(item) ? "status-overdue" : ""}">状态: ${getEventStatusLabel(item)}</span>
          <span class="tag">子任务: ${esc(subtaskProgress(item))}</span>
          <span class="tag">重复: ${esc(recurrenceLabel(item.recurrence))}</span>
          ${(item.tags || []).map((t) => `<span class="tag-soft">#${esc(t)}</span>`).join("")}
        </div>
      </div>
      <div class="row-actions">
        <button data-action="toggle" data-id="${esc(item.id)}" class="ghost">${item.completed ? "设为未完成" : "设为完成"}</button>
        <button data-action="edit" data-id="${esc(item.id)}" class="ghost">编辑</button>
        <button data-action="delete" data-id="${esc(item.id)}" class="danger">删除</button>
      </div>
    </article>
  `).join("");
  return `<div class="list">${html}</div>`;
}

function renderTable(events) {
  const rows = events.map((item) => `
    <tr class="tbl-row ${esc(item.priority)} ${item.completed ? "completed" : ""} ${isOverdue(item) ? "overdue" : ""}">
      <td>${esc(item.title)}</td>
      <td>${priorityLabel[item.priority] || "日常"}</td>
      <td>${esc((item.tags || []).join(", ") || "-")}</td>
      <td>${esc(subtaskProgress(item))}</td>
      <td>${esc(recurrenceLabel(item.recurrence))}</td>
      <td><span class="${isOverdue(item) ? "due-overdue tag" : ""}">${esc(fmtDateTime(item.dueAt))}</span></td>
      <td><span class="tag ${isOverdue(item) ? "status-overdue" : ""}">${getEventStatusLabel(item)}</span></td>
      <td>
        <button data-action="toggle" data-id="${esc(item.id)}" class="ghost">切换完成</button>
        <button data-action="edit" data-id="${esc(item.id)}" class="ghost">编辑</button>
        <button data-action="delete" data-id="${esc(item.id)}" class="danger">删除</button>
      </td>
    </tr>
  `).join("");

  return `
    <table class="table">
      <thead>
        <tr>
          <th>标题</th>
          <th>粒度</th>
          <th>标签</th>
          <th>子任务</th>
          <th>重复</th>
          <th>DDL</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderTimeline(events) {
  const html = events.map((item) => `
    <div class="tl-item ${esc(item.priority)} ${item.completed ? "completed" : ""} ${isOverdue(item) ? "overdue" : ""}">
      <div style="display:flex; justify-content:space-between; gap:8px; align-items:center;">
        <strong>${esc(item.title)}</strong>
      </div>
      <div>${priorityLabel[item.priority] || "日常"} | DDL: <span class="${isOverdue(item) ? "due-overdue tag" : ""}">${esc(fmtDateTime(item.dueAt))}</span></div>
      <div>状态：<span class="tag ${isOverdue(item) ? "status-overdue" : ""}">${getEventStatusLabel(item)}</span></div>
      <div>标签：${esc((item.tags || []).join(", ") || "无")}</div>
      <div>子任务进度：${esc(subtaskProgress(item))}</div>
      <div>重复：${esc(recurrenceLabel(item.recurrence))}</div>
      <div>${esc(item.note || "无备注")}</div>
      <div class="row-actions" style="margin-top:6px;">
        <button data-action="toggle" data-id="${esc(item.id)}" class="ghost">${item.completed ? "设为未完成" : "设为完成"}</button>
        <button data-action="edit" data-id="${esc(item.id)}" class="ghost">编辑</button>
        <button data-action="delete" data-id="${esc(item.id)}" class="danger">删除</button>
      </div>
    </div>
  `).join("");

  return `<div class="timeline">${html}</div>`;
}

function renderCalendar(events) {
  const map = new Map();
  for (const item of events) {
    const key = normalizeDate(item.dueAt);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);

  const cells = [];
  for (let i = 0; i < first.getDay(); i += 1) {
    cells.push('<div class="day"><div class="day-head"></div></div>');
  }

  for (let day = 1; day <= last.getDate(); day += 1) {
    const key = `${y}-${pad(m + 1)}-${pad(day)}`;
    const items = map.get(key) || [];
    const list = items
      .slice(0, 3)
      .map((it) => `<div class="dot-item ${it.completed ? "completed" : ""} ${isOverdue(it) ? "overdue" : ""}">${esc(it.title)}</div>`)
      .join("");
    const more = items.length > 3 ? `<div class="dot-item">+${items.length - 3} 更多</div>` : "";
    cells.push(`<div class="day"><div class="day-head">${day} 日</div>${list}${more}</div>`);
  }

  return `<div class="calendar">${cells.join("")}</div>`;
}

function buildTodayList(items, emptyText) {
  if (!items.length) return `<div class="today-item"><small>${emptyText}</small></div>`;
  return items.slice(0, 6).map((item) => `
    <div class="today-item">
      <div>${esc(item.title)} (${esc(subtaskProgress(item))})</div>
      <small>${esc(fmtDateTime(item.dueAt))}</small>
    </div>
  `).join("");
}

function renderTodayPanel() {
  const today = normalizeDate(new Date().toISOString());
  const active = state.events.filter((x) => !x.completed && x.dueAt);
  const dueToday = sortedEvents(active.filter((x) => normalizeDate(x.dueAt) === today));
  const overdue = sortedEvents(active.filter((x) => isOverdue(x)));

  els.todayPanel.innerHTML = `
    <article class="today-card">
      <h3>今天到期 (${dueToday.length})</h3>
      <div class="today-list">${buildTodayList(dueToday, "今天没有到期事件")}</div>
    </article>
    <article class="today-card">
      <h3>已逾期 (${overdue.length})</h3>
      <div class="today-list">${buildTodayList(overdue, "没有逾期事件")}</div>
    </article>
  `;
}

function renderStatsPanel() {
  const total = state.events.length;
  const active = state.events.filter((x) => !x.completed).length;
  const done = state.events.filter((x) => x.completed).length;
  const overdue = state.events.filter((x) => isOverdue(x)).length;

  const today = normalizeDate(new Date().toISOString());
  const completedToday = state.events.filter((x) => x.completed && x.completedAt && normalizeDate(x.completedAt) === today).length;

  const urgentAll = state.events.filter((x) => x.priority === "urgent").length;
  const urgentDone = state.events.filter((x) => x.priority === "urgent" && x.completed).length;
  const urgentRate = urgentAll ? Math.round((urgentDone / urgentAll) * 100) : 0;
  const completeRate = total ? Math.round((done / total) * 100) : 0;

  els.statsPanel.innerHTML = `
    <article class="stat-card"><small>总事件</small><strong>${total}</strong></article>
    <article class="stat-card"><small>进行中</small><strong>${active}</strong></article>
    <article class="stat-card"><small>今日完成</small><strong>${completedToday}</strong></article>
    <article class="stat-card"><small>逾期数量</small><strong>${overdue}</strong></article>
    <article class="stat-card"><small>总完成率 / 紧急完成率</small><strong>${completeRate}% / ${urgentRate}%</strong></article>
  `;
}

function render() {
  const events = filteredEvents();
  updateResultStat(events);
  renderTodayPanel();
  renderStatsPanel();

  if (!events.length) {
    els.viewContent.innerHTML = '<div class="empty">没有匹配的事件，调整筛选条件试试。</div>';
    return;
  }

  if (state.currentView === "list") {
    els.viewContent.innerHTML = renderList(events);
  } else if (state.currentView === "table") {
    els.viewContent.innerHTML = renderTable(events);
  } else if (state.currentView === "timeline") {
    els.viewContent.innerHTML = renderTimeline(events);
  } else {
    els.viewContent.innerHTML = renderCalendar(events);
  }
}

async function refresh() {
  state.events = await window.reminderApi.listEvents();
  render();
}

function parseDueAt() {
  if (!els.dueAt.value) return "";
  const d = new Date(els.dueAt.value);
  if (Number.isNaN(d.getTime())) throw new Error("DDL 时间格式无效");
  return d.toISOString();
}

function parseRecurrence() {
  if (!els.recurrenceEnabled.checked) {
    return {
      enabled: false,
      freq: "daily",
      interval: 1,
      endDate: "",
      maxOccurrences: 0,
      occurrenceIndex: 1,
      seriesId: ""
    };
  }

  const interval = Math.max(1, Math.min(365, Number(els.recurrenceInterval.value) || 1));
  const maxOccurrences = Math.max(0, Math.min(999, Number(els.recurrenceMaxOccurrences.value) || 0));
  const endDate = els.recurrenceEndDate.value ? new Date(`${els.recurrenceEndDate.value}T23:59:59`).toISOString() : "";

  return {
    enabled: true,
    freq: els.recurrenceFreq.value || "daily",
    interval,
    endDate,
    maxOccurrences,
    occurrenceIndex: 1,
    seriesId: ""
  };
}

function getReminderSettingsFromUI() {
  return {
    reminders: {
      enabled: els.reminderEnabled.checked,
      rules: {
        day: els.reminderDay.checked,
        hour: els.reminderHour.checked,
        tenMin: els.reminderTenMin.checked,
        overdue: els.reminderOverdue.checked
      }
    }
  };
}

function applyReminderSettings(settings) {
  const reminders = settings.reminders || {};
  const rules = reminders.rules || {};
  els.reminderEnabled.checked = reminders.enabled !== false;
  els.reminderDay.checked = rules.day !== false;
  els.reminderHour.checked = rules.hour !== false;
  els.reminderTenMin.checked = rules.tenMin !== false;
  els.reminderOverdue.checked = rules.overdue !== false;
}

function showInAppReminder(payload) {
  const title = payload?.title || "提醒";
  const body = payload?.body || "";
  const time = new Date().toLocaleTimeString();
  els.inAppReminder.innerHTML = `<strong>${esc(title)}</strong><br>${esc(body).replaceAll("\n", "<br>")}<br><small>${time}</small>`;
  els.inAppReminder.classList.remove("hidden");

  if (reminderBannerTimer) clearTimeout(reminderBannerTimer);
  reminderBannerTimer = setTimeout(() => {
    els.inAppReminder.classList.add("hidden");
  }, 9000);
}

function bindWorkspaceTabs() {
  const panes = {
    overview: document.getElementById("pane-overview"),
    events: document.getElementById("pane-events"),
    settings: document.getElementById("pane-settings")
  };

  const setPane = (pane) => {
    for (const [key, node] of Object.entries(panes)) {
      if (!node) continue;
      node.classList.toggle("active", key === pane);
    }
    for (const btn of els.workspaceTabs.querySelectorAll("button[data-pane]")) {
      btn.classList.toggle("active", btn.dataset.pane === pane);
    }
  };

  els.workspaceTabs.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-pane]");
    if (!btn) return;
    setPane(btn.dataset.pane || "overview");
  });

  setPane("overview");
}

els.addSubtaskBtn.addEventListener("click", () => {
  const text = String(els.subtaskInput.value || "").trim();
  if (!text) return;
  state.formSubtasks.push({
    id: `sub_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
    text: text.slice(0, 120),
    completed: false
  });
  els.subtaskInput.value = "";
  renderSubtaskEditor();
});

els.subtaskInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    els.addSubtaskBtn.click();
  }
});

els.subtaskList.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const id = target.dataset.id;
  if (!id) return;

  if (target.dataset.action === "delete-subtask") {
    state.formSubtasks = state.formSubtasks.filter((x) => x.id !== id);
  }
  if (target.dataset.action === "toggle-subtask") {
    state.formSubtasks = state.formSubtasks.map((x) => x.id === id ? { ...x, completed: !x.completed } : x);
  }
  renderSubtaskEditor();
});

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const dueAt = parseDueAt();
    if (dueAt && new Date(dueAt).getTime() < Date.now()) {
      const ok = confirm("该 DDL 早于当前时间，仍然保存吗？");
      if (!ok) return;
    }

    const payload = {
      id: els.id.value,
      title: els.title.value.trim(),
      note: els.note.value.trim(),
      priority: els.priority.value,
      dueAt,
      tags: parseTags(els.tags.value),
      subtasks: state.formSubtasks,
      recurrence: parseRecurrence()
    };

    if (!payload.title) {
      alert("标题不能为空");
      return;
    }

    if (payload.id) {
      const current = state.events.find((x) => x.id === payload.id);
      if (current?.recurrence?.seriesId) {
        payload.recurrence.seriesId = current.recurrence.seriesId;
        payload.recurrence.occurrenceIndex = current.recurrence.occurrenceIndex || 1;
      }
      await window.reminderApi.updateEvent(payload);
    } else {
      await window.reminderApi.addEvent(payload);
    }

    resetForm();
    setCreatorOpen(false);
    await refresh();
  } catch (err) {
    alert(err.message || "保存失败");
  }
});

els.cancelEdit.addEventListener("click", () => {
  resetForm();
  setCreatorOpen(false);
});

els.openCreatorBtn.addEventListener("click", () => {
  resetForm();
  setCreatorOpen(true);
});

els.closeCreatorBtn.addEventListener("click", () => {
  resetForm();
  setCreatorOpen(false);
});

els.creatorOverlay.addEventListener("click", (event) => {
  if (event.target === els.creatorOverlay) {
    resetForm();
    setCreatorOpen(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.creatorOverlay.classList.contains("hidden")) {
    resetForm();
    setCreatorOpen(false);
  }
});

els.viewTabs.addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-view]");
  if (!btn) return;
  state.currentView = btn.dataset.view;
  for (const b of els.viewTabs.querySelectorAll("button")) {
    b.classList.toggle("active", b === btn);
  }
  render();
});

els.viewContent.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;

  const action = target.dataset.action;
  const id = target.dataset.id;
  if (!id) return;

  if (action === "toggle") {
    await window.reminderApi.toggleEvent(id);
    await refresh();
    return;
  }

  if (action === "delete") {
    const ok = confirm("确定删除该事件吗？");
    if (!ok) return;
    await window.reminderApi.deleteEvent(id);
    if (els.id.value === id) resetForm();
    await refresh();
    return;
  }

  if (action === "edit") {
    const item = state.events.find((x) => x.id === id);
    if (item) startEdit(item);
  }
});

function bindFilterEvents() {
  els.searchKeyword.addEventListener("input", () => {
    state.filters.keyword = els.searchKeyword.value;
    render();
  });
  els.filterPriority.addEventListener("change", () => {
    state.filters.priority = els.filterPriority.value;
    render();
  });
  els.filterStatus.addEventListener("change", () => {
    state.filters.status = els.filterStatus.value;
    render();
  });
  els.filterTag.addEventListener("input", () => {
    state.filters.tag = els.filterTag.value;
    render();
  });
}

function bindReminderEvents() {
  for (const input of [els.reminderEnabled, els.reminderDay, els.reminderHour, els.reminderTenMin, els.reminderOverdue]) {
    input.addEventListener("change", async () => {
      state.settings = await window.reminderApi.updateSettings(getReminderSettingsFromUI());
      applyReminderSettings(state.settings);
    });
  }
}

els.autoStart.addEventListener("change", async () => {
  state.settings = await window.reminderApi.updateSettings({ autoStart: els.autoStart.checked });
});

els.alwaysOnTop.addEventListener("change", async () => {
  state.settings = await window.reminderApi.updateSettings({ alwaysOnTop: els.alwaysOnTop.checked });
});

async function boot() {
  const settings = await window.reminderApi.getSettings();
  state.settings = settings;
  els.autoStart.checked = Boolean(settings.autoStart);
  els.alwaysOnTop.checked = Boolean(settings.alwaysOnTop);
  applyReminderSettings(settings);
  bindFilterEvents();
  bindReminderEvents();
  bindWorkspaceTabs();
  window.reminderApi.onReminder((payload) => showInAppReminder(payload));
  resetForm();
  await refresh();
}

boot();



