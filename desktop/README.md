# irida pet — desktop overlay (prototype)

A Clippy-style floating companion for the blue dog (`tparser-dog-butterfly`).
It's a transparent, frameless, always-on-top window that shows the dog and a
speech bubble reacting to what the agent is doing.

## Run

```bash
cd desktop
npm install        # fetches Electron (~one-time, downloads a Chromium binary)
npm run demo       # cycle through every state — no agent needed (best for eval)
npm start          # follow the live agent: reads ../.agent/pet-state.json
```

Point it at another snapshot (e.g. prod under `$IRIDA_HOME`):

```bash
PET_STATE_PATH=/path/to/.agent/pet-state.json npm start
```

- **Drag** the dog (or bubble) to move it. Hover to reveal the **×** close button.
- The window parks itself bottom-right of the primary display.

## How it connects to the agent

The agent runtime already writes `.agent/pet-state.json`
([src/petRuntime.ts](../src/petRuntime.ts)) with `state` / `theme` / `label`.
The overlay polls that file (`main.js`) and pushes changes to the renderer,
which swaps the sprite + bubble text and applies a per-state CSS animation.

## Assets

Every state is an animated, transparent WebP in
`../deploy/assets/pet/dist/<theme>/`:

- `working.webp` — the real hand-drawn chase loop: white background keyed out,
  ground line removed, rebuilt from the GIF (440×238, 88 frames) by
  `python3 deploy/scripts/build-dog-overlay.py`.
- `idle/happy/sad/sleep.webp` — synthesized from the static RGBA sprites with
  foot-anchored procedural motion (breathing, bounce, droop, sleep + zZz) by
  `python3 deploy/scripts/build-dog-states.py`.

`build-dog-overlay.py` will pick up a real GIF for ANY state if you drop a
`dist/<theme>/<state>.gif`, so swapping a synthesized state for hand-drawn art
later is a no-code change.

## Status / next steps

This is an evaluation prototype, on the path to a polished desktop pet:

- [x] Transparent animated `working` from the chase GIF (floor line removed)
- [x] Every state animated (synthesized from static art)
- [ ] Hand-drawn GIFs for idle/happy/sad/sleep (drop-in via build-dog-overlay.py)
- [ ] Normalize dog scale between chase and synthesized states
- [ ] Tray icon + show/hide + "snap to corner"; click-through when idle
- [ ] Package as a `.app` (electron-builder) and/or port the renderer to Tauri
