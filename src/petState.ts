/**
 * Desktop pet emotional state (I-97) — derived from turn / tool activity.
 */
import type { ActivityDetail } from "./host.js";

export const PET_STATES = ["idle", "working", "happy", "sad", "sleep", "retry", "worried"] as const;
export type PetState = (typeof PET_STATES)[number];

export type PetTheme = "light" | "dark";

/** Brief happy flash after a successful turn. */
export const PET_HAPPY_MS = 8_000;

/** No activity → sleep (matches agent idle TTL default). */
export const PET_SLEEP_MS = 20 * 60 * 1000;

/** Hiccup flash after an overload retry (I-148). */
export const PET_RETRY_MS = 6_000;

export interface PetSignals {
  turnBusy: boolean;
  toolRunning: boolean;
  lastTurnOk?: boolean;
  lastTurnError?: boolean;
  /** Last overload-retry moment (onTurnRetry) — hiccup for retryMs. */
  retryAtMs?: number;
  /** Store/memory writes are degrading (persistSoft/soft fired) — uneasy until an ok turn. */
  storeDegraded?: boolean;
  lastEventAtMs: number;
  nowMs?: number;
  happyMs?: number;
  sleepMs?: number;
  retryMs?: number;
}

export function resolvePetState(signals: PetSignals): PetState {
  const now = signals.nowMs ?? Date.now();
  const happyMs = signals.happyMs ?? PET_HAPPY_MS;
  const sleepMs = signals.sleepMs ?? PET_SLEEP_MS;
  const retryMs = signals.retryMs ?? PET_RETRY_MS;
  const idleMs = now - signals.lastEventAtMs;

  // A hiccup interrupts even "working" — that is the point of showing it.
  if (signals.retryAtMs != null && now - signals.retryAtMs < retryMs) return "retry";
  if (signals.turnBusy || signals.toolRunning) return "working";
  if (signals.lastTurnError) return "sad";
  // Degraded store keeps Wisp uneasy (and awake) until a clean turn resets it.
  if (signals.storeDegraded) return "worried";
  if (signals.lastTurnOk && idleMs < happyMs) return "happy";
  if (!signals.turnBusy && idleMs >= sleepMs) return "sleep";
  return "idle";
}

/** XP → level steps (I-148): lv2 at 10, then 25/50/100/200/400/800… (×2). */
export function levelForXp(xp: number): number {
  let level = 1;
  let need = 10;
  let total = Math.max(0, Math.floor(xp));
  while (total >= need) {
    level++;
    need = need < 25 ? 25 : need * 2;
  }
  return level;
}

export function activityToolRunning(activity: ActivityDetail): boolean {
  return activity.phase === "call" && activity.status !== "error";
}
