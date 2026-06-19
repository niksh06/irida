/**
 * Terminal setup for csagent TUI.
 *
 * Alternate screen (DEC 1049) disables the terminal scrollback buffer — trackpad
 * scrolling stops working in Cursor/iTerm. Keep alt screen opt-in via CSAGENT_TUI_ALT=1.
 *
 * Default mode: full transcript in scrollback → native trackpad scroll.
 * Alt screen: DEC 1007 maps wheel to arrow keys for Ink virtual viewport.
 */
import { csagentTuiAlt } from "../env.js";

export function useAltScreen(): boolean {
  return csagentTuiAlt() === "1";
}

export function enterTuiTerminal(): void {
  if (!process.stdout.isTTY) return;
  if (useAltScreen()) {
    process.stdout.write("\x1b[?1049h\x1b[H\x1b[?25l");
    process.stdout.write("\x1b[?1007h");
  }
}

export function leaveTuiTerminal(): void {
  if (!process.stdout.isTTY) return;
  if (useAltScreen()) {
    process.stdout.write("\x1b[?1007l\x1b[?25h\x1b[?1049l");
  }
}
