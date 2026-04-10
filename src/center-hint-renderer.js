const root = document.getElementById("hintRoot");
const textEl = document.getElementById("hintText");

let hideTimer = null;

function showHint(text) {
  if (textEl) {
    const safe = String(text || "").trim();
    textEl.textContent = safe || "请检查一下你的事件安排";
  }
  if (!root) return;
  root.classList.add("show");
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    root.classList.remove("show");
  }, 1200);
}

window.centerHintApi.onShow((text) => showHint(text));
