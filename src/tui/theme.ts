/** Hermes-inspired palette for csagent TUI. */
export const theme = {
  brand: "csagent",
  icon: "◆",
  primary: "#56B6C2",
  accent: "#C678DD",
  border: "#3E4451",
  text: "#ABB2BF",
  muted: "#5C6370",
  user: "#61AFEF",
  assistant: "#E5E9F0",
  system: "#98C379",
  warn: "#E5C07B",
  error: "#E06C75",
  statusBg: "#282C34",
  statusFg: "#ABB2BF",
  statusGood: "#98C379",
  statusBusy: "#E5C07B",
  prompt: "#56B6C2",
} as const;

export const banner = `
 ╭──────────────────────────────────────╮
 │  ◆ csagent  ·  Cursor SDK agent      │
 ╰──────────────────────────────────────╯`;
