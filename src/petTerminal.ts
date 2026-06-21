/**
 * In-terminal mascot (I-97) — «Wisp», a tiny watching spirit. Hand-drawn Unicode, no assets.
 */
import {
  PET_HAPPY_MS,
  PET_SLEEP_MS,
  resolvePetState,
  type PetState,
} from "./petState.js";

export interface PetActivityLike {
  phase?: "call" | "result";
  status?: "running" | "completed" | "error";
}

export interface TuiPetSignals {
  busy: boolean;
  activityLog: PetActivityLike[];
  lastTurnOk: boolean;
  lastTurnError: boolean;
  lastEventAtMs: number;
  nowMs?: number;
}

export function deriveTuiPetState(signals: TuiPetSignals): PetState {
  const toolRunning = signals.activityLog.some(
    (e) => e.phase === "call" && e.status === "running"
  );
  return resolvePetState({
    turnBusy: signals.busy,
    toolRunning,
    lastTurnOk: signals.lastTurnOk,
    lastTurnError: signals.lastTurnError,
    lastEventAtMs: signals.lastEventAtMs,
    nowMs: signals.nowMs,
    happyMs: PET_HAPPY_MS,
    sleepMs: PET_SLEEP_MS,
  });
}

/** Ink color role for a glyph segment. */
export type PetColorRole = "accent" | "warn" | "good" | "muted" | "primary" | "error";

export interface PetGlyph {
  t: string;
  c?: PetColorRole;
}

export interface PetGlyphLine {
  parts: readonly PetGlyph[];
}

type PetFrame = readonly PetGlyphLine[];
type PetAnim = readonly PetFrame[];

/**
 * Wisp — floating eye-spirit (◆ irida companion).
 *
 * Every frame is 5 lines tall (aura · top · eye · base · tail) so the corner
 * never jumps vertically when the state changes, and decorations are padded to
 * the 8-column body width so they sit centered under the eye despite the
 * right-aligned (flex-end) layout. Each state animates so the pet feels alive.
 */
// Every frame is exactly 5 rows (aura · top · eye · base · tail) and 8 visual
// columns wide, so the corner never jumps. Row 2 always carries exactly one eye
// glyph. Richer multi-frame loops give Wisp real life: it blinks, glances around,
// trails sparkles when idle, spins + crackles when working, bursts with confetti
// when happy, sheds a falling tear when sad, and breathes with rising zZz asleep.
export const PET_WISP_FRAMES: Record<PetState, PetAnim> = {
  // idle — calm float: a drifting sparkle, a blink, and glances left/right.
  idle: [
    [
      { parts: [{ t: " ", c: "muted" }, { t: "✦", c: "accent" }, { t: "  ·  ·", c: "muted" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │  ", c: "primary" }, { t: "◉", c: "accent" }, { t: "  │", c: "primary" }] },
      { parts: [{ t: " ╰──┬──╯", c: "primary" }] },
      { parts: [{ t: "    ", c: "muted" }, { t: "◇", c: "accent" }, { t: "   ", c: "muted" }] },
    ],
    [
      { parts: [{ t: " ·  ", c: "muted" }, { t: "✦", c: "accent" }, { t: "  ·", c: "muted" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │  ", c: "primary" }, { t: "◉", c: "accent" }, { t: "  │", c: "primary" }] },
      { parts: [{ t: " ╰──┬──╯", c: "primary" }] },
      { parts: [{ t: "    ", c: "muted" }, { t: "✧", c: "accent" }, { t: "   ", c: "muted" }] },
    ],
    [
      { parts: [{ t: " ·  ·  ", c: "muted" }, { t: "✦", c: "accent" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │  ", c: "primary" }, { t: "◑", c: "accent" }, { t: "  │", c: "primary" }] },
      { parts: [{ t: " ╰──┬──╯", c: "primary" }] },
      { parts: [{ t: "     ", c: "muted" }, { t: "✧", c: "accent" }, { t: "  ", c: "muted" }] },
    ],
    [
      { parts: [{ t: " ·  ·  ·", c: "muted" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │  ", c: "primary" }, { t: "‿", c: "accent" }, { t: "  │", c: "primary" }] },
      { parts: [{ t: " ╰──┬──╯", c: "primary" }] },
      { parts: [{ t: "    ", c: "muted" }, { t: "·", c: "muted" }, { t: "   ", c: "muted" }] },
    ],
    [
      { parts: [{ t: "✦", c: "accent" }, { t: "  ·  · ", c: "muted" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │  ", c: "primary" }, { t: "◐", c: "accent" }, { t: "  │", c: "primary" }] },
      { parts: [{ t: " ╰──┬──╯", c: "primary" }] },
      { parts: [{ t: "   ", c: "muted" }, { t: "✧", c: "accent" }, { t: "    ", c: "muted" }] },
    ],
  ],
  // working — the single eye spins (◐→◓→◑→◒) while energy crackles in the tail.
  working: [
    [
      { parts: [{ t: " ", c: "muted" }, { t: "✦", c: "warn" }, { t: " · · ", c: "muted" }, { t: "✦", c: "warn" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │  ", c: "primary" }, { t: "◐", c: "warn" }, { t: "  │", c: "primary" }] },
      { parts: [{ t: " ╰──┬──╯", c: "primary" }] },
      { parts: [{ t: "   ", c: "muted" }, { t: "ϟ", c: "warn" }, { t: "    ", c: "muted" }] },
    ],
    [
      { parts: [{ t: " · ", c: "muted" }, { t: "✦", c: "accent" }, { t: " · ", c: "muted" }, { t: "✦", c: "accent" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │  ", c: "primary" }, { t: "◓", c: "warn" }, { t: "  │", c: "primary" }] },
      { parts: [{ t: " ╰──┬──╯", c: "primary" }] },
      { parts: [{ t: "    ", c: "muted" }, { t: "↯", c: "warn" }, { t: "   ", c: "muted" }] },
    ],
    [
      { parts: [{ t: "✦", c: "accent" }, { t: " · ", c: "muted" }, { t: "✦", c: "accent" }, { t: " · ", c: "muted" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │  ", c: "primary" }, { t: "◑", c: "warn" }, { t: "  │", c: "primary" }] },
      { parts: [{ t: " ╰──┬──╯", c: "primary" }] },
      { parts: [{ t: "   ", c: "muted" }, { t: "≋≋", c: "warn" }, { t: "   ", c: "muted" }] },
    ],
    [
      { parts: [{ t: " · ", c: "muted" }, { t: "✦", c: "warn" }, { t: " · ·", c: "muted" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │  ", c: "primary" }, { t: "◒", c: "warn" }, { t: "  │", c: "primary" }] },
      { parts: [{ t: " ╰──┬──╯", c: "primary" }] },
      { parts: [{ t: "    ", c: "muted" }, { t: "≋", c: "warn" }, { t: "   ", c: "muted" }] },
    ],
  ],
  // happy — confetti bursts, then the beam settles into a calm arc.
  happy: [
    [
      { parts: [{ t: " ", c: "muted" }, { t: "✦", c: "good" }, { t: " ", c: "muted" }, { t: "✧", c: "accent" }, { t: " ", c: "muted" }, { t: "✦", c: "good" }, { t: "  ", c: "muted" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │  ", c: "primary" }, { t: "◕", c: "good" }, { t: "  │", c: "primary" }] },
      { parts: [{ t: " ╰──", c: "primary" }, { t: "▽", c: "good" }, { t: "──╯", c: "primary" }] },
      { parts: [{ t: "    ", c: "muted" }, { t: "✧", c: "good" }, { t: "   ", c: "muted" }] },
    ],
    [
      { parts: [{ t: " ", c: "muted" }, { t: "✧", c: "accent" }, { t: " ", c: "muted" }, { t: "✦", c: "good" }, { t: " ", c: "muted" }, { t: "✦", c: "good" }, { t: " ", c: "muted" }, { t: "✧", c: "accent" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │  ", c: "primary" }, { t: "^", c: "good" }, { t: "  │", c: "primary" }] },
      { parts: [{ t: " ╰──", c: "primary" }, { t: "▽", c: "good" }, { t: "──╯", c: "primary" }] },
      { parts: [{ t: "   ", c: "muted" }, { t: "✦", c: "good" }, { t: "    ", c: "muted" }] },
    ],
    [
      { parts: [{ t: " ", c: "muted" }, { t: "✦", c: "good" }, { t: "  ·  ", c: "muted" }, { t: "✦", c: "good" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │  ", c: "primary" }, { t: "◠", c: "good" }, { t: "  │", c: "primary" }] },
      { parts: [{ t: " ╰──", c: "primary" }, { t: "▽", c: "good" }, { t: "──╯", c: "primary" }] },
      { parts: [{ t: "    ", c: "muted" }, { t: "✧", c: "good" }, { t: "   ", c: "muted" }] },
    ],
    [
      { parts: [{ t: " ·  ", c: "muted" }, { t: "✦", c: "good" }, { t: "  ·", c: "muted" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │  ", c: "primary" }, { t: "◕", c: "good" }, { t: "  │", c: "primary" }] },
      { parts: [{ t: " ╰──", c: "primary" }, { t: "▽", c: "good" }, { t: "──╯", c: "primary" }] },
      { parts: [{ t: "    ", c: "muted" }, { t: "·", c: "muted" }, { t: "   ", c: "muted" }] },
    ],
  ],
  // sad — a droopy eye and a tear that wells up, falls, and drips away.
  sad: [
    [
      { parts: [{ t: " ·  ·  ·", c: "muted" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │  ", c: "primary" }, { t: "╥", c: "error" }, { t: "  │", c: "primary" }] },
      { parts: [{ t: " ╰─────╯", c: "primary" }] },
      { parts: [{ t: "        ", c: "muted" }] },
    ],
    [
      { parts: [{ t: " ·  ·  ·", c: "muted" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │  ", c: "primary" }, { t: "╥", c: "error" }, { t: "  │", c: "primary" }] },
      { parts: [{ t: " ╰─────╯", c: "primary" }] },
      { parts: [{ t: "    ", c: "muted" }, { t: "˙", c: "accent" }, { t: "   ", c: "muted" }] },
    ],
    [
      { parts: [{ t: " ·  ·  ·", c: "muted" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │  ", c: "primary" }, { t: "╥", c: "error" }, { t: "  │", c: "primary" }] },
      { parts: [{ t: " ╰─────╯", c: "primary" }] },
      { parts: [{ t: "    ", c: "muted" }, { t: "ˎ", c: "accent" }, { t: "   ", c: "muted" }] },
    ],
    [
      { parts: [{ t: " ·  ·  ·", c: "muted" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │  ", c: "primary" }, { t: "╥", c: "error" }, { t: "  │", c: "primary" }] },
      { parts: [{ t: " ╰─────╯", c: "primary" }] },
      { parts: [{ t: "    ", c: "muted" }, { t: "‚", c: "accent" }, { t: "   ", c: "muted" }] },
    ],
  ],
  // sleep — soft breathing and a zZz that rises and fades.
  sleep: [
    [
      { parts: [{ t: " z ", c: "muted" }, { t: "·", c: "muted" }, { t: " Z  ", c: "accent" }] },
      { parts: [{ t: " ╭─────╮", c: "muted" }] },
      { parts: [{ t: " │  ", c: "muted" }, { t: "‿", c: "primary" }, { t: "  │", c: "muted" }] },
      { parts: [{ t: " ╰─────╯", c: "muted" }] },
      { parts: [{ t: "        ", c: "muted" }] },
    ],
    [
      { parts: [{ t: " Z ", c: "accent" }, { t: "·", c: "muted" }, { t: " z  ", c: "muted" }] },
      { parts: [{ t: " ╭─────╮", c: "muted" }] },
      { parts: [{ t: " │  ", c: "muted" }, { t: "-", c: "primary" }, { t: "  │", c: "muted" }] },
      { parts: [{ t: " ╰─────╯", c: "muted" }] },
      { parts: [{ t: "        ", c: "muted" }] },
    ],
    [
      { parts: [{ t: "  Z", c: "accent" }, { t: " · ", c: "muted" }, { t: "z ", c: "muted" }] },
      { parts: [{ t: " ╭─────╮", c: "muted" }] },
      { parts: [{ t: " │  ", c: "muted" }, { t: "‿", c: "primary" }, { t: "  │", c: "muted" }] },
      { parts: [{ t: " ╰─────╯", c: "muted" }] },
      { parts: [{ t: "        ", c: "muted" }] },
    ],
    [
      { parts: [{ t: " · ", c: "muted" }, { t: "Z", c: "muted" }, { t: "  · ", c: "muted" }] },
      { parts: [{ t: " ╭─────╮", c: "muted" }] },
      { parts: [{ t: " │  ", c: "muted" }, { t: "-", c: "primary" }, { t: "  │", c: "muted" }] },
      { parts: [{ t: " ╰─────╯", c: "muted" }] },
      { parts: [{ t: "        ", c: "muted" }] },
    ],
  ],
};

/** Glyph shown in the working pet's tail, hinting at what tool is active. */
const ACTIVITY_GLYPH: Record<PetActivityKind, string> = {
  shell: "›_",
  read: "▤",
  edit: "✎",
  search: "⌕",
  mcp: "⇄",
  tool: "ϟ", // 1-cell (⚡ is 2 display cells → would break the 8-col row)
};

/**
 * The "thought" line above the pet — shows what it is busy with, flanked by
 * muted dots, centered so the glyph sits over the eye.
 */
function activityThoughtParts(glyph: string): PetGlyph[] {
  // Keep the row exactly 8 cols with the glyph centered over the eye, whatever
  // the glyph's width (e.g. shell "›_" is 2 cells) — so the corner never jumps.
  const inner = Math.max(0, 8 - 2 - [...glyph].length); // spaces between the two flanking dots
  const left = Math.ceil(inner / 2);
  return [
    { t: "·" + " ".repeat(left), c: "muted" },
    { t: glyph, c: "warn" },
    { t: " ".repeat(inner - left) + "·", c: "muted" },
  ];
}

export function petTerminalFrame(
  state: PetState,
  tick: number,
  activity?: PetActivityKind
): PetGlyphLine[] {
  const frames = PET_WISP_FRAMES[state];
  const idx = frames.length > 1 ? tick % frames.length : 0;
  const lines = frames[idx]!.map((line) => ({ parts: [...line.parts] }));
  // Surface the active tool as a "thought" in the top line; the tail keeps its
  // baked ⚡/≋ energy pulse. "tool" is generic, so leave the sparkles alone.
  if (state === "working" && activity && activity !== "tool" && lines.length > 0) {
    lines[0] = { parts: activityThoughtParts(ACTIVITY_GLYPH[activity]) };
  }
  return lines;
}

/** @deprecated use petTerminalFrame — flat strings, single color */
export function petTerminalFrameLines(state: PetState, tick: number): string[] {
  return petTerminalFrame(state, tick).map((line) => line.parts.map((p) => p.t).join(""));
}

/** Category of the active tool — drives the contextual `working` label. */
export type PetActivityKind = "shell" | "read" | "edit" | "search" | "mcp" | "tool";

/**
 * Bucket the active tool into a category, mirroring the Telegram tool-progress
 * grouping so the pet and the chat feed describe work the same way.
 */
export function classifyPetActivity(
  toolName: string | undefined,
  kind: "tool" | "mcp" | "other" | undefined
): PetActivityKind {
  if (kind === "mcp") return "mcp";
  const n = (toolName ?? "").toLowerCase();
  if (n.includes("shell") || n === "run_terminal_cmd") return "shell";
  if (n.includes("read")) return "read";
  if (n.includes("write") || n.includes("edit")) return "edit";
  if (n.includes("grep") || n.includes("glob") || n.includes("search")) return "search";
  return "tool";
}

const WORKING_VERB: Record<PetActivityKind, string> = {
  shell: "running…",
  read: "reading…",
  edit: "writing…",
  search: "searching…",
  mcp: "connecting…",
  tool: "thinking…",
};

export function petTerminalLabel(state: PetState, activity?: PetActivityKind): string {
  switch (state) {
    case "idle":
      return "wisp · watching";
    case "working":
      return `wisp · ${WORKING_VERB[activity ?? "tool"]}`;
    case "happy":
      return "wisp · nice!";
    case "sad":
      return "wisp · oops";
    case "sleep":
      return "wisp · zzz";
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}