/**
 * TTL hygiene for temporal memory facts (seen_post dedup cache).
 */
import { createMemoryStore, type PruneFactsResult } from "./memoryStore.js";
import { SEEN_POST_SUBJECT } from "./memoryDedup.js";

/** Current facts older than this are invalidated on weekly audit cron. */
export const SEEN_POST_TTL_DAYS = 30;

export function parseOlderThanDays(raw: string): number | null {
  const m = raw.trim().match(/^(\d+)d$/i);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function pruneSeenPostFacts(
  dir: string,
  opts: { olderThanDays?: number; dryRun?: boolean } = {}
): Promise<PruneFactsResult> {
  const store = createMemoryStore(dir);
  try {
    return await store.pruneCurrentFacts({
      subject: SEEN_POST_SUBJECT,
      olderThanDays: opts.olderThanDays ?? SEEN_POST_TTL_DAYS,
      dryRun: opts.dryRun,
    });
  } finally {
    await store.close();
  }
}
