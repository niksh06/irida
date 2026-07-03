// Wisp desktop companion (I-146) — the irida pet in the macOS menu bar plus a
// floating always-on-top overlay. Frames are imported from the repo's compiled
// dist/petTerminal.js, so the overlay always draws the exact art the TUI shows.
//
//   npm start            follow the live agent snapshot (.agent/pet-state.json)
//   npm run demo         cycle through every state (no agent needed)
//   PET_STATE_PATH=...   point at a specific snapshot file
//
// Requires `npm run build` in the repo root first (dist/ must exist).
const { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, ipcMain, screen } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const REPO_ROOT = path.join(__dirname, "..");
const STATE_PATH =
  process.env.PET_STATE_PATH || path.join(REPO_ROOT, ".agent", "pet-state.json");
const DEMO = process.argv.includes("--demo");
const OPEN_CHAT = process.argv.includes("--chat");
const TICK_MS = 600; // frame advance + snapshot poll
const STALE_MS = 15 * 60 * 1000; // ignore busy/ok flags from a dead agent process

const WIN_W = 240;
const WIN_H = 210;

// ---- Chat peer (I-147) — talks to the gateway's local webhook ----
// The secret stays in the MAIN process only; the renderer never sees it.
const CHAT_TIMEOUT_MS = 10 * 60 * 1000; // a turn can legitimately run minutes

function iridaHomeDir() {
  return process.env.IRIDA_HOME || process.env.CSAGENT_HOME || path.join(os.homedir(), ".irida");
}

// Prod convenience: the launchd env file already holds the webhook secret
// (mode 0600, same user). Value is never logged and never leaves this process.
function readSecretFromIridaEnv() {
  try {
    const raw = fs.readFileSync(path.join(iridaHomeDir(), "irida.env"), "utf8");
    const m = raw.match(/^\s*(?:export\s+)?GATEWAY_WEBHOOK_SECRET=["']?([^"'\r\n#]+)/m);
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}

const CHAT = {
  url: process.env.IRIDA_WEBHOOK_URL || "http://127.0.0.1:18789/hook",
  chatId: process.env.IRIDA_DESKTOP_CHAT_ID || "desktop",
  secret: process.env.GATEWAY_WEBHOOK_SECRET || readSecretFromIridaEnv(),
};

let wisp = null; // dist/petTerminal.js: petTerminalFrame, petTerminalLabel
let resolvePetState = null; // dist/petState.js — the agent's own state machine

async function loadWispModules() {
  const dist = (f) => pathToFileURL(path.join(REPO_ROOT, "dist", f)).href;
  try {
    wisp = await import(dist("petTerminal.js"));
    ({ resolvePetState } = await import(dist("petState.js")));
  } catch (e) {
    console.error("wisp: cannot load dist/petTerminal.js — run `npm run build` in the repo root first");
    console.error(String((e && e.message) || e));
    app.exit(1);
  }
}

function readSnapshot() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    if (!raw || typeof raw.state !== "string") return null;
    return raw;
  } catch {
    return null;
  }
}

// Re-derive the state with a live clock (happy fades after 8s, sleep kicks in
// at 20min) via the same state machine the agent runs. A snapshot older than
// STALE_MS has its turn flags ignored so a crashed agent can't pin "working".
function liveSignals(snap) {
  const at = snap && snap.updatedAt ? Date.parse(snap.updatedAt) : NaN;
  const lastEventAtMs = Number.isFinite(at) ? at : 0;
  const stale = !snap || Date.now() - lastEventAtMs > STALE_MS;
  return {
    state: resolvePetState({
      turnBusy: !stale && Boolean(snap.turnBusy),
      toolRunning: !stale && Boolean(snap.toolRunning),
      lastTurnOk: stale ? undefined : snap.lastTurnOk,
      lastTurnError: stale ? undefined : snap.lastTurnError,
      lastEventAtMs,
    }),
    activity: !stale && snap.activity ? snap.activity : undefined,
  };
}

// The single glyph living in the menu bar: row 2 of every frame carries exactly
// one eye (frame invariant in petTerminal.ts) between the │ body walls.
function eyeGlyph(lines) {
  const row = lines[2];
  if (!row) return "◉";
  for (const part of row.parts) {
    const t = String(part.t).trim();
    if (t && !t.includes("│")) return t;
  }
  return "◉";
}

let win = null;
let tray = null;
let tick = 0;
let lastEye = "";
let lastTooltip = "";

// Demo: hold each state a few ticks so its animation loop is visible.
const DEMO_SEQ = [
  { state: "idle" },
  { state: "working", activity: "search" },
  { state: "working", activity: "shell" },
  { state: "happy" },
  { state: "sad" },
  { state: "sleep" },
];
const DEMO_TICKS_PER_STATE = 6;

function currentSignals() {
  if (DEMO) {
    const step = Math.floor(tick / DEMO_TICKS_PER_STATE) % DEMO_SEQ.length;
    return DEMO_SEQ[step];
  }
  return liveSignals(readSnapshot());
}

function tickOnce() {
  tick += 1;
  const { state, activity } = currentSignals();
  const lines = wisp.petTerminalFrame(state, tick, activity);
  const label = wisp.petTerminalLabel(state, activity);
  const theme = nativeTheme.shouldUseDarkColors ? "dark" : "light";

  const eye = eyeGlyph(lines);
  if (tray) {
    if (eye !== lastEye) {
      lastEye = eye;
      tray.setTitle(eye, { fontType: "monospaced" });
    }
    if (label !== lastTooltip) {
      lastTooltip = label;
      tray.setToolTip(label);
    }
  }
  if (win && !win.isDestroyed() && win.isVisible()) {
    win.webContents.send("pet:state", { lines, label, state, theme });
  }
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: workArea.x + workArea.width - WIN_W - 24,
    y: workArea.y + workArea.height - WIN_H - 24,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    fullscreenable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function toggleWindow() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (win.isVisible()) win.hide();
  else win.show();
}

// ---- Chat window (I-147) ----
let chatWin = null;
let quitting = false;

function createChatWindow() {
  chatWin = new BrowserWindow({
    width: 420,
    height: 560,
    minWidth: 320,
    minHeight: 400,
    title: "irida — chat",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  chatWin.loadFile(path.join(__dirname, "renderer", "chat.html"));
  // Menu-bar app: closing the chat hides it; Quit lives in the tray menu.
  chatWin.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      chatWin.hide();
    }
  });
}

function toggleChat() {
  if (!chatWin || chatWin.isDestroyed()) {
    createChatWindow();
    return;
  }
  if (chatWin.isVisible()) chatWin.hide();
  else {
    chatWin.show();
    chatWin.focus();
  }
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("irida wisp");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Chat…", click: toggleChat },
      { label: "Show / hide Wisp", click: toggleWindow },
      { type: "separator" },
      { label: "Quit", role: "quit" },
    ])
  );
}

ipcMain.on("pet:hide", () => {
  if (win && !win.isDestroyed()) win.hide();
});
ipcMain.on("pet:quit", () => app.quit());

// Renderer gets connection facts for its header — never the secret itself.
ipcMain.handle("chat:info", () => ({
  url: CHAT.url,
  chatId: CHAT.chatId,
  hasSecret: Boolean(CHAT.secret),
}));

ipcMain.handle("chat:send", async (_e, rawText) => {
  const text = String(rawText ?? "").trim();
  if (!text) return { ok: false, error: "пустое сообщение" };
  if (!CHAT.secret) {
    return {
      ok: false,
      error:
        "нет секрета вебхука — задай GATEWAY_WEBHOOK_SECRET в окружении (или он должен лежать в ~/.irida/irida.env)",
    };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHAT_TIMEOUT_MS);
  try {
    const res = await fetch(CHAT.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-gateway-secret": CHAT.secret },
      body: JSON.stringify({ chatId: CHAT.chatId, text }),
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 429) return { ok: false, busy: true, error: "агент занят другим ходом — повтори чуть позже" };
    if (res.status === 401) return { ok: false, error: "gateway отверг секрет (401) — секрет не совпадает" };
    if (res.status === 403) return { ok: false, error: `chatId «${CHAT.chatId}» не в allowlist gateway (403)` };
    if (!res.ok || !body || body.ok !== true) {
      return { ok: false, error: String((body && body.error) || `HTTP ${res.status}`) };
    }
    return { ok: true, reply: String(body.reply ?? "") };
  } catch (e) {
    if (e && e.name === "AbortError") return { ok: false, error: "таймаут (10 мин) — ход не завершился" };
    return { ok: false, error: "нет связи с gateway — он запущен и webhook включён (секрет настроен)?" };
  } finally {
    clearTimeout(timer);
  }
});

app.whenReady().then(async () => {
  await loadWispModules();
  if (process.platform === "darwin" && app.dock) app.dock.hide(); // menu-bar app
  createTray();
  createWindow();
  if (OPEN_CHAT) createChatWindow();
  tickOnce();
  setInterval(tickOnce, TICK_MS);
});

// Menu-bar app: closing/hiding the overlay must not quit — the tray owns quit.
app.on("before-quit", () => {
  quitting = true;
});
app.on("window-all-closed", () => {});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
