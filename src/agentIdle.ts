/**
 * Proactive SDK agent refresh after idle (issue I-9).
 * Env: CSAGENT_AGENT_IDLE_MS — milliseconds; 0 disables. Default 20 minutes.
 */
import { csagentAgentIdleMs } from "./env.js";

const DEFAULT_IDLE_MS = 20 * 60 * 1000;

export function resolveAgentIdleMs(): number {
  const raw = csagentAgentIdleMs();
  if (!raw) return DEFAULT_IDLE_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_IDLE_MS;
  return Math.floor(n);
}

export function isAgentIdle(lastTouchAtMs: number, nowMs: number = Date.now()): boolean {
  const idleMs = resolveAgentIdleMs();
  if (idleMs <= 0) return false;
  return nowMs - lastTouchAtMs >= idleMs;
}
