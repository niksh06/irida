# Wisp — irida desktop companion (menu bar + overlay)

The irida pet living in the macOS menu bar: an animated eye-glyph in the tray
(watching → spinning while the agent works → ✕/celebration on turn results) and
an optional floating always-on-top overlay drawing the exact 5-line Wisp frames
the TUI renders.

One source of truth for the art: the app imports `../dist/petTerminal.js` /
`../dist/petState.js` — the same modules `irida tui` uses. No sprites, no copies.

## Run

```bash
npm run build      # in the REPO ROOT first — the app imports dist/
cd desktop
npm install        # fetches Electron (one-time)
npm run demo       # cycle through every state — no agent needed
npm start          # follow the live agent: reads ../.agent/pet-state.json
```

Snapshot pick order: `PET_STATE_PATH` env → freshest of the dev repo's
`.agent/pet-state.json` and the prod gateway's `~/.irida/.agent/pet-state.json`
(the gateway writes to its home dir, not the prod repo copy). Pin explicitly:

```bash
PET_STATE_PATH=$HOME/.irida/.agent/pet-state.json npm start
```

- **Menu bar**: the eye animates with the pet state; tooltip shows the label
  (`wisp · running…`); menu → Show/hide Wisp, Quit. The Dock icon is hidden.
- **Overlay**: drag to move; hover → × hides it (the tray keeps running);
  parks bottom-right of the primary display; light/dark follows the system.

## How it connects to the agent

`chatEngine.sendTurn` (every surface: TUI, Telegram gateway, cron, chat CLI)
feeds a `PetRuntimeTracker` that persists `.agent/pet-state.json`
([src/petRuntime.ts](../src/petRuntime.ts)) — state machine, activity bucket,
turn flags. Disable with `"pet": {"enabled": false}` in `agent.config.json`.
The app polls the snapshot (600ms), re-derives the state with a live clock
(happy fades in 8s, sleep at 20min — same rules as the agent), and animates.

A snapshot older than 15min has its busy flags ignored, so a crashed agent
can't pin the pet in "working".

## Legacy

The previous blue-dog PNG overlay (csagent era) is gone; the PNG pipeline under
`deploy/assets/pet/` still resolves `assetPath` in snapshots for anything that
wants bitmaps, but nothing in this app uses it.

## Chat (этап 2, I-147)

Tray → **Chat…** (or `npm run chat`) opens a chat window talking to the SAME
gateway brain as Telegram, via its local webhook:

- The gateway (telegram adapter) also listens on `http://127.0.0.1:18789/hook`
  **only when** `GATEWAY_WEBHOOK_SECRET` is configured (deny by default).
- The app reads the secret from its environment or from `~/.irida/irida.env`
  (never shown to the renderer, never logged).
- The `desktop` chatId must be in the gateway allowlist. Override with
  `IRIDA_DESKTOP_CHAT_ID` / `IRIDA_WEBHOOK_URL`.
- Slash commands work (`/engine`, `/status`, `/stop`, …) — same router.
- No streaming (webhook is request/response): the window shows an elapsed
  "думаю…" row; the menu-bar eye animates through the pet bridge meanwhile.
