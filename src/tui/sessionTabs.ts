import type { SessionRecord } from "../store.js";

/** Max sessions shown in the tab bar (matches SessionTabBar). */
export const SESSION_TAB_BAR_MAX = 5;

export function visibleTabSessions(sessions: SessionRecord[]): SessionRecord[] {
  return sessions.slice(0, SESSION_TAB_BAR_MAX);
}

/** Map hotkey digit 1–5 to zero-based tab index, or null. */
export function parseSessionTabHotkey(inputKey: string): number | null {
  if (inputKey.length !== 1) return null;
  const n = inputKey.charCodeAt(0) - 49; // '1' → 0
  if (n < 0 || n >= SESSION_TAB_BAR_MAX) return null;
  return n;
}

export function sessionAtTabIndex(sessions: SessionRecord[], index: number): SessionRecord | null {
  const visible = visibleTabSessions(sessions);
  if (index < 0 || index >= visible.length) return null;
  return visible[index] ?? null;
}

/** Keep tab bar slot order stable across switches (listSessions reorders by updated_at). */
export function mergeTabBarSessions(
  prev: SessionRecord[],
  fresh: SessionRecord[],
  max = SESSION_TAB_BAR_MAX
): SessionRecord[] {
  const byId = new Map(fresh.map((s) => [s.id, s]));
  const merged: SessionRecord[] = [];
  for (const p of prev) {
    const row = byId.get(p.id);
    if (row) merged.push(row);
  }
  if (merged.length === 0) return fresh.slice(0, max);
  for (const s of fresh) {
    if (merged.length >= max) break;
    if (!merged.some((m) => m.id === s.id)) merged.push(s);
  }
  return merged.slice(0, max);
}

export function tabCycleIndex(
  tabs: SessionRecord[],
  currentId: string | null | undefined,
  delta: number
): number | null {
  if (tabs.length < 2) return null;
  let idx = tabs.findIndex((s) => s.id === currentId);
  if (idx < 0) idx = 0;
  return (idx + delta + tabs.length) % tabs.length;
}
