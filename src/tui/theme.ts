/**
 * Hermes-inspired palette for irida TUI. Brightened 2026-07-03 (user: "очень
 * бледно" vs Claude Code): the One-Dark greys read washed-out on a dark bg, so
 * body text and muted are pushed up in luminance for real contrast; accents
 * (already vivid) kept. Muted especially — it drives hints/separators and at
 * #5C6370 was near-invisible.
 */
export const theme = {
  brand: "Irida",
  icon: "◆",
  primary: "#5CC7D4",
  accent: "#C88CF0",
  border: "#4A515F",
  text: "#D4DAE4",
  muted: "#8A93A3",
  user: "#6FB6F2",
  assistant: "#F2F4F8",
  system: "#A9D28A",
  warn: "#EBC777",
  error: "#F07178",
  statusBg: "#2C313A",
  statusFg: "#D4DAE4",
  statusGood: "#A9D28A",
  statusBusy: "#EBC777",
  prompt: "#5CC7D4",
} as const;

export const banner = `
 ╭──────────────────────────────────────╮
 │  ◆ irida  ·  SDK agent               │
 ╰──────────────────────────────────────╯`;

/** Below this width the boxed banner overflows/wraps — use a one-liner (I-156). */
export const COMPACT_BANNER_COLS = 44;

/** One-line banner for narrow terminals. */
export const compactBanner = ` ◆ irida · SDK agent`;

/** Width-aware banner: boxed when it fits, compact otherwise. */
export function bannerFor(cols: number): string {
  return cols < COMPACT_BANNER_COLS ? compactBanner : banner.replace(/^\n/, "");
}
