// Chat renderer (I-147): transcript + composer over window.chatAPI. The
// gateway webhook is request/response (no streaming) — while a turn runs we
// show an elapsed pending row; the menu-bar eye animates via the pet bridge.
const logEl = document.getElementById("log");
const connEl = document.getElementById("conn");
const form = document.getElementById("composer");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");

let busy = false;
let pendingEl = null;
let pendingTimer = null;

function addRow(cls, text) {
  const row = document.createElement("div");
  row.className = `row ${cls}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  row.appendChild(bubble);
  logEl.appendChild(row);
  logEl.scrollTop = logEl.scrollHeight;
  return bubble;
}

function showPending() {
  const started = Date.now();
  pendingEl = addRow("agent pending", "думаю…");
  pendingTimer = setInterval(() => {
    const s = Math.round((Date.now() - started) / 1000);
    pendingEl.textContent = `думаю… ${s}s`;
  }, 1000);
}

function clearPending() {
  if (pendingTimer) clearInterval(pendingTimer);
  pendingTimer = null;
  if (pendingEl) pendingEl.closest(".row").remove();
  pendingEl = null;
}

function setBusy(v) {
  busy = v;
  sendBtn.disabled = v;
  input.disabled = v;
  if (!v) input.focus();
}

async function send() {
  const text = input.value.trim();
  if (!text || busy) return;
  addRow("user", text);
  input.value = "";
  setBusy(true);
  showPending();
  const res = await window.chatAPI.send(text);
  clearPending();
  setBusy(false);
  if (res.ok) addRow("agent", res.reply || "(пустой ответ)");
  else addRow(res.busy ? "notice" : "error", res.error || "неизвестная ошибка");
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  send();
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

window.chatAPI.info().then((info) => {
  connEl.textContent = `${info.chatId} → ${info.url}`;
  connEl.title = "Слэш-команды гейтвея работают: /engine, /status, /stop …";
  if (!info.hasSecret) {
    addRow(
      "error",
      "Секрет вебхука не найден. Задай GATEWAY_WEBHOOK_SECRET в окружении приложения " +
        "(или храни его в ~/.irida/irida.env) и перезапусти."
    );
  }
  input.focus();
});
