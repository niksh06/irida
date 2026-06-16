/**
 * Legacy dedup helpers via memory_facts.
 * @deprecated Digest jobs no longer write seen_post (window-only dedup in prompts).
 * Use purgeAllSeenPostFacts() to drop legacy rows; helpers kept for tests.
 */
import { loadConfig } from "./config.js";
import { createMemoryStore, type MemoryFact } from "./memoryStore.js";

export const SEEN_POST_SUBJECT = "seen_post";

export function seenPostPredicate(channel: string): string {
  return channel.trim();
}

export function seenPostObject(postId: string): string {
  return postId.trim();
}

export async function isPostSeen(
  dir: string,
  channel: string,
  postId: string
): Promise<boolean> {
  const cfg = loadConfig(dir);
  const store = createMemoryStore(dir, cfg.stateDir);
  try {
    const facts = await store.queryFacts({
      subject: SEEN_POST_SUBJECT,
      predicate: seenPostPredicate(channel),
    });
    const obj = seenPostObject(postId);
    return facts.some((f) => f.object === obj);
  } finally {
    await store.close();
  }
}

export async function markPostSeen(
  dir: string,
  channel: string,
  postId: string,
  source = "cron"
): Promise<MemoryFact> {
  const cfg = loadConfig(dir);
  const store = createMemoryStore(dir, cfg.stateDir);
  try {
    // Idempotent: repeated mark for the same post must not pile up duplicate
    // current facts (they bloat the cron seen-posts preamble).
    const existing = await store.queryFacts({
      subject: SEEN_POST_SUBJECT,
      predicate: seenPostPredicate(channel),
      currentOnly: true,
    });
    const obj = seenPostObject(postId);
    const dup = existing.find((f) => f.object === obj);
    if (dup) return dup;
    return await store.addFact({
      subject: SEEN_POST_SUBJECT,
      predicate: seenPostPredicate(channel),
      object: seenPostObject(postId),
      source,
    });
  } finally {
    await store.close();
  }
}

export async function listSeenPosts(
  dir: string,
  opts: { limit?: number; predicate?: string } = {}
): Promise<MemoryFact[]> {
  const cfg = loadConfig(dir);
  const store = createMemoryStore(dir, cfg.stateDir);
  try {
    const facts = await store.queryFacts({
      subject: SEEN_POST_SUBJECT,
      predicate: opts.predicate,
      currentOnly: true,
    });
    const limit = opts.limit ?? 100;
    return facts.slice(0, limit);
  } finally {
    await store.close();
  }
}

/** Compact block for cron prompt preamble. */
export function formatSeenPostsBlock(facts: MemoryFact[]): string {
  if (facts.length === 0) {
    return "No posts marked seen yet (memory_facts subject=seen_post).";
  }
  const lines = facts.map((f) => `- ${f.predicate}:${f.object} (since ${f.valid_from ?? "?"})`);
  return (
    "Already seen posts (memory_facts — skip these, use memory_fact_add for new ones):\n" +
    lines.join("\n")
  );
}

export async function buildSeenPostsPromptSection(
  dir: string,
  opts: { limit?: number; predicate?: string } = {}
): Promise<string> {
  const facts = await listSeenPosts(dir, opts);
  return formatSeenPostsBlock(facts);
}
