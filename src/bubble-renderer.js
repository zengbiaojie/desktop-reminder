const shell = document.getElementById("bubbleShell");
const urgentCountEl = document.getElementById("urgentCount");

const dragState = {
  dragging: false,
  downMouseX: 0,
  downMouseY: 0,
  downAt: 0
};

let countTimer = null;
let blinkTimer = null;
let blinkResetTimer = null;
let unsubscribeSettings = null;

function normalizeBlinkSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(3600, Math.round(n)));
}

function triggerBlink() {
  if (!shell) return;
  shell.classList.remove("blinking");
  // Force reflow so repeat toggles can retrigger animation.
  // eslint-disable-next-line no-unused-expressions
  shell.offsetWidth;
  shell.classList.add("blinking");
  if (blinkResetTimer) clearTimeout(blinkResetTimer);
  blinkResetTimer = setTimeout(() => {
    shell.classList.remove("blinking");
  }, 900);
}

function applyBlinkSettings(settings) {
  const seconds = normalizeBlinkSeconds(settings?.bubbleBlinkSeconds);
  if (blinkTimer) {
    clearInterval(blinkTimer);
    blinkTimer = null;
  }
  if (seconds <= 0) return;
  blinkTimer = setInterval(() => {
    if (dragState.dragging) return;
    triggerBlink();
  }, seconds * 1000);
}

async function refreshUrgentCount() {
  try {
    const count = await window.bubbleApi.getUrgentCount();
    urgentCountEl.textContent = String(Number.isFinite(count) ? count : 0);
  } catch {
    urgentCountEl.textContent = "0";
  }
}

shell?.addEventListener("contextmenu", async (event) => {
  event.preventDefault();
  await window.bubbleApi.showBubbleMenu();
});

shell?.addEventListener("mousedown", async (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  dragState.dragging = true;
  dragState.downMouseX = event.screenX;
  dragState.downMouseY = event.screenY;
  dragState.downAt = Date.now();
  await window.bubbleApi.startBubbleDrag(event.screenX, event.screenY);
});

window.addEventListener("mouseup", async (event) => {
  if (event.button !== 0) return;
  if (!dragState.dragging) return;

  const dx = Math.abs(event.screenX - dragState.downMouseX);
  const dy = Math.abs(event.screenY - dragState.downMouseY);
  const dt = Date.now() - dragState.downAt;
  const shouldRestore = dx <= 4 && dy <= 4 && dt <= 250;

  dragState.dragging = false;
  await window.bubbleApi.endBubbleDrag();

  if (shouldRestore) {
    await window.bubbleApi.restoreMainWindow();
  }
});

window.addEventListener("blur", async () => {
  if (!dragState.dragging) return;
  dragState.dragging = false;
  await window.bubbleApi.endBubbleDrag();
});

shell?.addEventListener("dragstart", (event) => {
  event.preventDefault();
});

window.addEventListener("load", async () => {
  await refreshUrgentCount();
  countTimer = setInterval(refreshUrgentCount, 5000);
  try {
    const settings = await window.bubbleApi.getSettings();
    applyBlinkSettings(settings || {});
  } catch {
    applyBlinkSettings({ bubbleBlinkSeconds: 0 });
  }
  unsubscribeSettings = window.bubbleApi.onSettings((payload) => {
    applyBlinkSettings(payload || {});
  });
});

window.addEventListener("beforeunload", async () => {
  if (dragState.dragging) {
    dragState.dragging = false;
    await window.bubbleApi.endBubbleDrag();
  }
  if (countTimer) {
    clearInterval(countTimer);
    countTimer = null;
  }
  if (blinkTimer) {
    clearInterval(blinkTimer);
    blinkTimer = null;
  }
  if (blinkResetTimer) {
    clearTimeout(blinkResetTimer);
    blinkResetTimer = null;
  }
  if (typeof unsubscribeSettings === "function") {
    unsubscribeSettings();
    unsubscribeSettings = null;
  }
});
