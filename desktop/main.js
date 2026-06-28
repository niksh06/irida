// Desktop overlay for the csagent blue-dog pet — a Clippy-style floating
// companion. The main process owns a transparent, frameless, always-on-top
// window and feeds it pet state polled from `.agent/pet-state.json` (the same
// snapshot the agent runtime already writes via src/petRuntime.ts).
//
//   npm start            follow the live agent snapshot
//   npm run demo         cycle through every state (no agent needed)
//   PET_STATE_PATH=...   point at a specific snapshot file
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "..");
const STATE_PATH =
  process.env.PET_STATE_PATH || path.join(REPO_ROOT, ".agent", "pet-state.json");
const DEMO = process.argv.includes("--demo");
const POLL_MS = 700;
const STALE_MS = 15 * 60 * 1000; // snapshot older than this → treat as idle

const WIN_W = 460;
const WIN_H = 340;

/** Resolve the transparent sprite directory for a theme. */
function assetsDir(theme) {
  const t = theme === "dark" ? "dark" : "light";
  return path.join(REPO_ROOT, "deploy", "assets", "pet", "dist", t);
}

let win = null;

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

  win.webContents.on("did-finish-load", () => {
    pushOnce();
    if (DEMO) startDemo();
    else startPolling();
  });
}

let lastSig = "";

function send(snap) {
  if (!win || win.isDestroyed()) return;
  const theme = snap.theme === "dark" ? "dark" : "light";
  win.webContents.send("pet:state", {
    state: snap.state || "idle",
    theme,
    label: snap.label || null,
    assetsDir: assetsDir(theme),
    updatedAt: snap.updatedAt || null,
  });
}

function readSnapshot() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    if (!raw || typeof raw.state !== "string") return null;
    // Age out stale snapshots so the pet doesn't sit "happy" forever.
    if (raw.updatedAt) {
      const age = Date.now() - Date.parse(raw.updatedAt);
      if (Number.isFinite(age) && age > STALE_MS) return { ...raw, state: "idle" };
    }
    return raw;
  } catch {
    return null;
  }
}

function pushOnce() {
  const snap = readSnapshot();
  send(snap || { state: "idle", theme: "light" });
}

function startPolling() {
  setInterval(() => {
    const snap = readSnapshot() || { state: "idle", theme: "light" };
    const sig = `${snap.state}|${snap.theme}|${snap.label || ""}|${snap.updatedAt || ""}`;
    if (sig === lastSig) return;
    lastSig = sig;
    send(snap);
  }, POLL_MS);
}

function startDemo() {
  const states = ["idle", "working", "happy", "sad", "sleep"];
  const labels = { working: "Grep", happy: null, sad: null, idle: null, sleep: null };
  let i = 0;
  const tick = () => {
    const state = states[i % states.length];
    send({ state, theme: "light", label: labels[state], updatedAt: new Date().toISOString() });
    i += 1;
  };
  tick();
  setInterval(tick, 3500);
}

ipcMain.on("pet:quit", () => app.quit());

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
