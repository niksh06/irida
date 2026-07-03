/** Hermes-inspired palette for irida TUI. */
export const theme = {
  brand: "Irida",
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
