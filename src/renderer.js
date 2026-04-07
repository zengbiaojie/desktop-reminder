const state = {
  events: [],
  selectedIds: new Set(),
  currentView: "list",
  filters: {
    keyword: "",
    priority: "all",
    status: "all"
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
  id: document.getElementById("eventId"),
  title: document.getElementById("title"),
  note: document.getElementById("note"),
  priority: document.getElementById("priority"),
  dueAt: document.getElementById("dueAt"),
  saveBtn: document.getElementById("saveBtn"),
  cancelEdit: document.getElementById("cancelEdit"),
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
  selectVisibleBtn: document.getElementById("selectVisibleBtn"),
  clearSelectionBtn: document.getElementById("clearSelectionBtn"),
  batchCompleteBtn: document.getElementById("batchCompleteBtn"),
  batchDeleteBtn: document.getElementById("batchDeleteBtn"),
  autoStart: document.getElementById("autoStart"),
  alwaysOnTop: document.getElementById("alwaysOnTop"),
  hideBtn: document.getElementById("hideBtn"),
  emptyTemplate: document.getElementById("emptyTemplate")
};

let reminderBannerTimer = null;

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
  if (Number.isNaN(due)) return false;
  return due < Date.now();
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
    const ta = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const tb = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function filteredEvents() {
  const keyword = state.filters.keyword.toLowerCase().trim();
  return sortedEvents(state.events).filter((item) => {
    if (state.filters.priority !== "all" && item.priority !== state.filters.priority) {
      return false;
    }

    if (state.filters.status === "active" && item.completed) {
      return false;
    }
    if (state.filters.status === "completed" && !item.completed) {
      return false;
    }
    if (state.filters.status === "overdue" && !isOverdue(item)) {
      return false;
    }

    if (!keyword) return true;
    const text = `${item.title || ""} ${item.note || ""}`.toLowerCase();
    return text.includes(keyword);
  });
}

function updateBatchButtons(visibleEvents) {
  const selectedCount = state.selectedIds.size;
  const visibleCount = visibleEvents.length;

  els.resultStat.textContent = `当前显示 ${visibleCount} 条，已选择 ${selectedCount} 条`;
  els.selectVisibleBtn.disabled = visibleCount === 0;
  els.clearSelectionBtn.disabled = selectedCount === 0;
  els.batchCompleteBtn.disabled = selectedCount === 0;
  els.batchDeleteBtn.disabled = selectedCount === 0;
}

function resetForm() {
  els.id.value = "";
  els.title.value = "";
  els.note.value = "";
  els.priority.value = "daily";
  els.dueAt.value = "";
  els.formTitle.textContent = "新增事件";
  els.saveBtn.textContent = "保存事件";
  els.cancelEdit.classList.add("hidden");
}

function startEdit(event) {
  els.id.value = event.id;
  els.title.value = event.title;
  els.note.value = event.note || "";
  els.priority.value = event.priority;
  els.dueAt.value = toLocalInputValue(event.dueAt);
  els.formTitle.textContent = "编辑事件";
  els.saveBtn.textContent = "更新事件";
  els.cancelEdit.classList.remove("hidden");
}

function renderList(events) {
  const html = events.map((item) => `
    <article class="card ${esc(item.priority)} ${item.completed ? "completed" : ""}">
      <label class="select-cell"><input data-action="select" data-id="${esc(item.id)}" class="select-check" type="checkbox" ${state.selectedIds.has(item.id) ? "checked" : ""} /></label>
      <div class="card-main">
        <h3 data-action="toggle" data-id="${esc(item.id)}">${esc(item.title)}</h3>
        <p>${esc(item.note || "无备注")}</p>
        <div class="meta">
          <span class="tag">${priorityLabel[item.priority] || "日常"}</span>
          <span class="tag ${isOverdue(item) ? "due-overdue" : ""}">DDL: ${esc(fmtDateTime(item.dueAt))}</span>
          <span class="tag">${item.completed ? "已完成" : "进行中"}</span>
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
    <tr class="${item.completed ? "completed" : ""}">
      <td><input data-action="select" data-id="${esc(item.id)}" class="select-check" type="checkbox" ${state.selectedIds.has(item.id) ? "checked" : ""} /></td>
      <td>${esc(item.title)}</td>
      <td>${priorityLabel[item.priority] || "日常"}</td>
      <td><span class="${isOverdue(item) ? "due-overdue tag" : ""}">${esc(fmtDateTime(item.dueAt))}</span></td>
      <td>${item.completed ? "已完成" : "进行中"}</td>
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
          <th>选中</th>
          <th>标题</th>
          <th>粒度</th>
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
    <div class="tl-item ${item.completed ? "completed" : ""}">
      <div style="display:flex; justify-content:space-between; gap:8px; align-items:center;">
        <strong>${esc(item.title)}</strong>
        <label class="select-cell"><input data-action="select" data-id="${esc(item.id)}" class="select-check" type="checkbox" ${state.selectedIds.has(item.id) ? "checked" : ""} /></label>
      </div>
      <div>${priorityLabel[item.priority] || "日常"} | DDL: <span class="${isOverdue(item) ? "due-overdue tag" : ""}">${esc(fmtDateTime(item.dueAt))}</span></div>
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
    cells.push(`<div class="day"><div class="day-head"></div></div>`);
  }

  for (let day = 1; day <= last.getDate(); day += 1) {
    const key = `${y}-${pad(m + 1)}-${pad(day)}`;
    const items = map.get(key) || [];
    const list = items.slice(0, 3).map((it) => `<div class="dot-item">${esc(it.title)}</div>`).join("");
    const more = items.length > 3 ? `<div class="dot-item">+${items.length - 3} 更多</div>` : "";
    cells.push(`<div class="day"><div class="day-head">${day} 日</div>${list}${more}</div>`);
  }

  return `<div class="calendar">${cells.join("")}</div>`;
}

function buildTodayList(items, emptyText) {
  if (!items.length) {
    return `<div class="today-item"><small>${emptyText}</small></div>`;
  }

  return items.slice(0, 6).map((item) => `
    <div class="today-item">
      <div>${esc(item.title)}</div>
      <small>${esc(fmtDateTime(item.dueAt))}</small>
    </div>
  `).join("");
}

function renderTodayPanel() {
  const now = new Date();
  const todayKey = normalizeDate(now.toISOString());
  const active = state.events.filter((x) => !x.completed && x.dueAt);

  const dueToday = sortedEvents(active.filter((x) => normalizeDate(x.dueAt) === todayKey));
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

function render() {
  const events = filteredEvents();
  updateBatchButtons(events);
  renderTodayPanel();

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
  const eventIds = new Set(state.events.map((x) => x.id));
  state.selectedIds = new Set([...state.selectedIds].filter((id) => eventIds.has(id)));
  render();
}

function parseDueAt() {
  if (!els.dueAt.value) return "";
  const d = new Date(els.dueAt.value);
  if (Number.isNaN(d.getTime())) {
    throw new Error("DDL 时间格式无效");
  }
  return d.toISOString();
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
  if (!els.inAppReminder) return;
  const title = payload?.title || "提醒";
  const body = payload?.body || "";
  const time = new Date().toLocaleTimeString();
  els.inAppReminder.innerHTML = `<strong>${esc(title)}</strong><br>${esc(body).replaceAll("\n", "<br>")}<br><small>${time}</small>`;
  els.inAppReminder.classList.remove("hidden");

  if (reminderBannerTimer) {
    clearTimeout(reminderBannerTimer);
  }
  reminderBannerTimer = setTimeout(() => {
    els.inAppReminder.classList.add("hidden");
  }, 9000);
}

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
      dueAt
    };

    if (!payload.title) {
      alert("标题不能为空");
      return;
    }

    if (payload.id) {
      await window.reminderApi.updateEvent(payload);
    } else {
      await window.reminderApi.addEvent(payload);
    }

    resetForm();
    await refresh();
  } catch (err) {
    alert(err.message || "保存失败");
  }
});

els.cancelEdit.addEventListener("click", () => {
  resetForm();
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

  if (action === "select") {
    if (target.checked) {
      state.selectedIds.add(id);
    } else {
      state.selectedIds.delete(id);
    }
    updateBatchButtons(filteredEvents());
    return;
  }

  if (action === "toggle") {
    await window.reminderApi.toggleEvent(id);
    await refresh();
    return;
  }

  if (action === "delete") {
    const yes = confirm("确定删除该事件吗？");
    if (!yes) return;
    await window.reminderApi.deleteEvent(id);
    state.selectedIds.delete(id);
    if (els.id.value === id) {
      resetForm();
    }
    await refresh();
    return;
  }

  if (action === "edit") {
    const item = state.events.find((x) => x.id === id);
    if (item) {
      startEdit(item);
    }
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

  els.selectVisibleBtn.addEventListener("click", () => {
    for (const item of filteredEvents()) {
      state.selectedIds.add(item.id);
    }
    render();
  });

  els.clearSelectionBtn.addEventListener("click", () => {
    state.selectedIds.clear();
    render();
  });

  els.batchCompleteBtn.addEventListener("click", async () => {
    const ids = [...state.selectedIds];
    if (!ids.length) return;

    for (const id of ids) {
      const current = state.events.find((x) => x.id === id);
      if (!current || current.completed) continue;
      await window.reminderApi.updateEvent({ ...current, completed: true });
    }

    await refresh();
  });

  els.batchDeleteBtn.addEventListener("click", async () => {
    const ids = [...state.selectedIds];
    if (!ids.length) return;
    const yes = confirm(`确定删除已选择的 ${ids.length} 条事件吗？`);
    if (!yes) return;

    for (const id of ids) {
      await window.reminderApi.deleteEvent(id);
      state.selectedIds.delete(id);
    }

    if (ids.includes(els.id.value)) {
      resetForm();
    }
    await refresh();
  });
}

function bindReminderEvents() {
  for (const input of [
    els.reminderEnabled,
    els.reminderDay,
    els.reminderHour,
    els.reminderTenMin,
    els.reminderOverdue
  ]) {
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

els.hideBtn.addEventListener("click", async () => {
  await window.reminderApi.hideToTray();
});

async function boot() {
  const settings = await window.reminderApi.getSettings();
  state.settings = settings;
  els.autoStart.checked = Boolean(settings.autoStart);
  els.alwaysOnTop.checked = Boolean(settings.alwaysOnTop);
  applyReminderSettings(settings);
  bindFilterEvents();
  bindReminderEvents();
  window.reminderApi.onReminder((payload) => {
    showInAppReminder(payload);
  });
  await refresh();
}

boot();
