// Renderer: paint glyph-frame payloads from the main process —
// { lines: [{parts: [{t, c}]}], label, state, theme }. The glyphs are the very
// frames dist/petTerminal.js renders in the TUI; color roles map to CSS vars.
const wispEl = document.getElementById("wisp");
const labelEl = document.getElementById("label");
document.getElementById("close").addEventListener("click", () => window.petAPI.hide());

function render(payload) {
  document.body.className = `theme-${payload.theme === "dark" ? "dark" : "light"} state-${payload.state || "idle"}`;
  wispEl.replaceChildren();
  for (const line of payload.lines || []) {
    for (const part of line.parts || []) {
      const span = document.createElement("span");
      span.textContent = part.t;
      span.className = `c-${part.c || "primary"}`;
      wispEl.appendChild(span);
    }
    wispEl.appendChild(document.createTextNode("\n"));
  }
  labelEl.textContent = payload.label || "";
}

window.petAPI.onState(render);
