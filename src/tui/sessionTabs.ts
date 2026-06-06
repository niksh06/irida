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
