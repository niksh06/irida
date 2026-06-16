/**
 * Hygiene for legacy seen_post facts (deprecated — digest dedup is window-only).
 */
import { createMemoryStore, type PruneFactsResult } from "./memoryStore.js";
import { SEEN_POST_SUBJECT } from "./memoryDedup.js";

/** @deprecated seen_post no longer written; TTL prune kept for legacy rows only. */
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

/** Invalidate all current seen_post facts (one-time migration off memory_facts dedup). */
export async function purgeAllSeenPostFacts(
  dir: string,
  opts: { dryRun?: boolean } = {}
): Promise<PruneFactsResult> {
  const store = createMemoryStore(dir);
  try {
    const facts = await store.queryFacts({ subject: SEEN_POST_SUBJECT, currentOnly: true });
    if (opts.dryRun) {
      return { matched: facts.length, pruned: 0 };
    }
    let pruned = 0;
    for (const f of facts) {
      if (await store.invalidateFact(f.id)) pruned++;
    }
    return { matched: facts.length, pruned };
  } finally {
    await store.close();
  }
}

/** Invalidate current facts whose subject/predicate look like CLI flags (I-69). */
export async function purgeMalformedSubjectFacts(
  dir: string,
  opts: { dryRun?: boolean } = {}
): Promise<PruneFactsResult> {
  const store = createMemoryStore(dir);
  try {
    return await store.purgeMalformedSubjectFacts(opts);
  } finally {
    await store.close();
  }
}
