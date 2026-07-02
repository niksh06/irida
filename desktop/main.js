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
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const REPO_ROOT = path.join(__dirname, "..");
const STATE_PATH =
  process.env.PET_STATE_PATH || path.join(REPO_ROOT, ".agent", "pet-state.json");
const DEMO = process.argv.includes("--demo");
const TICK_MS = 600; // frame advance + snapshot poll
const STALE_MS = 15 * 60 * 1000; // ignore busy/ok flags from a dead agent process

const WIN_W = 240;
const WIN_H = 210;

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

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("irida wisp");
  tray.setContextMenu(
    Menu.buildFromTemplate([
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

app.whenReady().then(async () => {
  await loadWispModules();
  if (process.platform === "darwin" && app.dock) app.dock.hide(); // menu-bar app
  createTray();
  createWindow();
  tickOnce();
  setInterval(tickOnce, TICK_MS);
});

// Menu-bar app: closing/hiding the overlay must not quit — the tray owns quit.
app.on("window-all-closed", () => {});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
