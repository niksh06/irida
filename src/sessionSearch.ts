/**
 * Session search (I-25) — filter stored sessions by title/id.
 */
import type { IStore, SessionRecord } from "./store.js";

export interface SessionSearchOptions {
  channel?: string;
  limit?: number;
}

export async function searchSessions(
  store: IStore,
  query: string,
  opts: SessionSearchOptions = {}
): Promise<SessionRecord[]> {
  const limit = opts.limit ?? 20;
  const q = query.trim().toLowerCase();
  const rows = await store.listSessions(200, opts.channel ? { channel: opts.channel } : undefined);
  if (!q) return rows.slice(0, limit);
  return rows
    .filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        (s.title || "").toLowerCase().includes(q) ||
        (s.cwd || "").toLowerCase().includes(q)
    )
    .slice(0, limit);
}
