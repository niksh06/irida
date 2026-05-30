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

/** Append typed or pasted printable input to session picker filter. */
export function mergeSessionFilterInput(
  filter: string,
  input: string,
  opts: { ctrl?: boolean; meta?: boolean; backspace?: boolean }
): string {
  if (opts.backspace) return filter.slice(0, -1);
  if (opts.ctrl || opts.meta || !input) return filter;
  const printable = [...input].filter((ch) => ch >= " ").join("");
  return filter + printable;
}

/** Visible window for long session lists in the picker. */
export function sessionPickerWindow<T>(
  items: T[],
  index: number,
  maxVisible: number
): { visible: T[]; start: number; hiddenAbove: number; hiddenBelow: number } {
  const cap = Math.max(4, maxVisible);
  if (items.length <= cap) {
    return { visible: items, start: 0, hiddenAbove: 0, hiddenBelow: 0 };
  }
  let start = index - Math.floor(cap / 2);
  if (start < 0) start = 0;
  if (start + cap > items.length) start = items.length - cap;
  return {
    visible: items.slice(start, start + cap),
    start,
    hiddenAbove: start,
    hiddenBelow: items.length - start - cap,
  };
}
