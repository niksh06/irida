import type { SessionRecord } from "../store.js";

/** Fuzzy filter for session picker (id, title, cwd). */
export function filterSessions(sessions: SessionRecord[], query: string): SessionRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter((s) => {
    const title = (s.title || "").toLowerCase();
    const id = s.id.toLowerCase();
    const cwd = s.cwd.toLowerCase();
    return id.includes(q) || title.includes(q) || cwd.includes(q);
  });
}

export function sessionDisplayTitle(s: SessionRecord, max = 28): string {
  const t = (s.title || "").trim();
  if (t && t !== "chat session") {
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  }
  return s.id.slice(0, Math.min(12, max));
}
