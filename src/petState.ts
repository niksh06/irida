/**
 * Desktop pet emotional state (I-97) — derived from turn / tool activity.
 */
import type { ActivityDetail } from "./host.js";

export const PET_STATES = ["idle", "working", "happy", "sad", "sleep"] as const;
export type PetState = (typeof PET_STATES)[number];

export type PetTheme = "light" | "dark";

/** Brief happy flash after a successful turn. */
export const PET_HAPPY_MS = 8_000;

/** No activity → sleep (matches agent idle TTL default). */
export const PET_SLEEP_MS = 20 * 60 * 1000;

export interface PetSignals {
  turnBusy: boolean;
  toolRunning: boolean;
  lastTurnOk?: boolean;
  lastTurnError?: boolean;
  lastEventAtMs: number;
  nowMs?: number;
  happyMs?: number;
  sleepMs?: number;
}

export function resolvePetState(signals: PetSignals): PetState {
  const now = signals.nowMs ?? Date.now();
  const happyMs = signals.happyMs ?? PET_HAPPY_MS;
  const sleepMs = signals.sleepMs ?? PET_SLEEP_MS;
  const idleMs = now - signals.lastEventAtMs;

  if (signals.turnBusy || signals.toolRunning) return "working";
  if (signals.lastTurnError) return "sad";
  if (signals.lastTurnOk && idleMs < happyMs) return "happy";
  if (!signals.turnBusy && idleMs >= sleepMs) return "sleep";
  return "idle";
}

export function activityToolRunning(activity: ActivityDetail): boolean {
  return activity.phase === "call" && activity.status !== "error";
}
