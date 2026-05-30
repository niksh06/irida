/**
 * Terminal setup for csagent TUI.
 *
 * Alternate screen (DEC 1049) disables the terminal scrollback buffer — trackpad
 * scrolling stops working in Cursor/iTerm. Keep alt screen opt-in via CSAGENT_TUI_ALT=1.
 *
 * DEC 1007 (alternate scroll mode) maps wheel/trackpad to cursor-key sequences so
 * Ink can scroll the virtual transcript — enabled in both modes (v8).
 */

export function useAltScreen(): boolean {
  return (process.env.CSAGENT_TUI_ALT ?? "").trim() === "1";
}

export function enterTuiTerminal(): void {
  if (!process.stdout.isTTY) return;
  if (useAltScreen()) {
    process.stdout.write("\x1b[?1049h\x1b[H\x1b[?25l");
  }
  process.stdout.write("\x1b[?1007h");
}

export function leaveTuiTerminal(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write("\x1b[?1007l");
  if (useAltScreen()) {
    process.stdout.write("\x1b[?25h\x1b[?1049l");
  }
}
