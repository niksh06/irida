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

/** Wisp — floating eye-spirit (◆ csagent companion). */
export const PET_WISP_FRAMES: Record<PetState, PetAnim> = {
  idle: [
    [
      { parts: [{ t: "  ", c: "muted" }, { t: "✦", c: "accent" }, { t: " · ", c: "muted" }, { t: "✦", c: "accent" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │  ", c: "primary" }, { t: "◉", c: "accent" }, { t: "  │", c: "primary" }] },
      { parts: [{ t: " ╰──┬──╯", c: "primary" }] },
      { parts: [{ t: "    ", c: "muted" }, { t: "◇", c: "accent" }] },
    ],
  ],
  working: [
    [
      { parts: [{ t: " ", c: "muted" }, { t: "✦", c: "warn" }, { t: " · · ", c: "muted" }, { t: "✦", c: "warn" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │ ", c: "primary" }, { t: "◐", c: "warn" }, { t: "◑", c: "warn" }, { t: " │", c: "primary" }] },
      { parts: [{ t: " ╰──", c: "primary" }, { t: "⚡", c: "warn" }, { t: "─╯", c: "primary" }] },
    ],
    [
      { parts: [{ t: " ", c: "muted" }, { t: "·", c: "muted" }, { t: " ✦ ", c: "accent" }, { t: "·", c: "muted" }, { t: " ✦", c: "accent" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │ ", c: "primary" }, { t: "◑", c: "warn" }, { t: "◐", c: "warn" }, { t: " │", c: "primary" }] },
      { parts: [{ t: " ╰───", c: "primary" }, { t: "⚡", c: "warn" }] },
    ],
    [
      { parts: [{ t: " ✦ · ✦ ·", c: "accent" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │  ", c: "primary" }, { t: "◉", c: "warn" }, { t: "  │", c: "primary" }] },
      { parts: [{ t: " ╰──", c: "primary" }, { t: "≋≋", c: "warn" }, { t: "╯", c: "primary" }] },
    ],
  ],
  happy: [
    [
      { parts: [{ t: " ", c: "muted" }, { t: "✦", c: "good" }, { t: " ✦ ", c: "accent" }, { t: "✦", c: "good" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │  ", c: "primary" }, { t: "◕", c: "good" }, { t: "  │", c: "primary" }] },
      { parts: [{ t: " ╰──", c: "primary" }, { t: "▽", c: "good" }, { t: "──╯", c: "primary" }] },
    ],
  ],
  sad: [
    [
      { parts: [{ t: "  · · ·", c: "muted" }] },
      { parts: [{ t: " ╭─────╮", c: "primary" }] },
      { parts: [{ t: " │  ", c: "primary" }, { t: "╥", c: "error" }, { t: "  │", c: "primary" }] },
      { parts: [{ t: " ╰─────╯", c: "primary" }] },
    ],
  ],
  sleep: [
    [
      { parts: [{ t: "  z ", c: "muted" }, { t: "Z", c: "accent" }, { t: " z", c: "muted" }] },
      { parts: [{ t: " ╭─────╮", c: "muted" }] },
      { parts: [{ t: " │  ", c: "muted" }, { t: "-", c: "primary" }, { t: "  │", c: "muted" }] },
      { parts: [{ t: " ╰─────╯", c: "muted" }] },
    ],
  ],
};

export function petTerminalFrame(state: PetState, tick: number): PetGlyphLine[] {
  const frames = PET_WISP_FRAMES[state];
  const idx = frames.length > 1 ? tick % frames.length : 0;
  return frames[idx]!.map((line) => ({ parts: [...line.parts] }));
}

/** @deprecated use petTerminalFrame — flat strings, single color */
export function petTerminalFrameLines(state: PetState, tick: number): string[] {
  return petTerminalFrame(state, tick).map((line) => line.parts.map((p) => p.t).join(""));
}

export function petTerminalLabel(state: PetState): string {
  switch (state) {
    case "idle":
      return "wisp · watching";
    case "working":
      return "wisp · thinking…";
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