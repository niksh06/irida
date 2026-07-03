/**
 * Terminal setup for irida TUI.
 *
 * Alternate screen (DEC 1049) disables the terminal scrollback buffer — trackpad
 * scrolling stops working in Cursor/iTerm. Keep alt screen opt-in via CSAGENT_TUI_ALT=1.
 *
 * Default mode: full transcript in scrollback → native trackpad scroll.
 * Alt screen: DEC 1007 maps wheel to arrow keys for Ink virtual viewport.
 */
import { useEffect, useState } from "react";
import { useStdout } from "ink";
import { iridaTuiAlt } from "../env.js";

export function useAltScreen(): boolean {
  return iridaTuiAlt() === "1";
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

export function readTerminalSize(stdout?: { columns?: number; rows?: number }): TerminalSize {
  return {
    cols: stdout?.columns && stdout.columns > 0 ? stdout.columns : 80,
    rows: stdout?.rows && stdout.rows > 0 ? stdout.rows : 24,
  };
}

/**
 * Reactive terminal dimensions (I-156). Ink re-flows its Yoga layout on resize
 * but does NOT re-run the component — so anything computed in JS from cols/rows
 * (manual text wrap, viewport height, tab-bar width) stayed frozen at the old
 * size and drifted out of sync with the reflowed frame. Subscribing to
 * `stdout.on('resize')` and storing the size in React state forces a re-render,
 * so every `useMemo([..., cols])` recomputes against the live width.
 *
 * Debounced one animation frame's worth (~48ms): a drag fires dozens of resize
 * events; we only need the last one.
 */
export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();
  const [size, setSize] = useState<TerminalSize>(() => readTerminalSize(stdout));

  useEffect(() => {
    if (!stdout) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setSize((prev) => {
          const next = readTerminalSize(stdout);
          return next.cols === prev.cols && next.rows === prev.rows ? prev : next;
        });
      }, 48);
    };
    stdout.on("resize", onResize);
    // Reconcile once on mount in case the size changed between initial state and effect.
    onResize();
    return () => {
      if (timer) clearTimeout(timer);
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  return size;
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
