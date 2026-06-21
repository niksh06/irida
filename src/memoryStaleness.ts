/**
 * Memory staleness annotation (I-115). Recalled memory reflects what was true
 * when written; the model otherwise treats injected notes as current. When a
 * note is older than the threshold we append a one-line caution so the model
 * re-verifies code-coupled details (a file, function, flag, or path) instead of
 * trusting a stale `file:line` as fact. Annotation only — never blocks recall.
 */
export const DEFAULT_STALENESS_DAYS = 7;

/**
 * Whole-day age of a note when it exceeds `maxAgeDays`, else null (fresh ≤
 * maxAgeDays, undated/unparseable, or maxAgeDays ≤ 0 = disabled). Pure — `now`
 * is injected. The stale/fresh gate uses the unfloored age; the returned number
 * is floored for display only.
 */
export function staleDays(
  updatedAt: string | undefined | null,
  now: number,
  maxAgeDays: number = DEFAULT_STALENESS_DAYS
): number | null {
  if (!updatedAt || maxAgeDays <= 0) return null;
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) return null;
  const ageDays = (now - t) / 86_400_000;
  if (ageDays <= maxAgeDays) return null;
  return Math.floor(ageDays);
}

/**
 * One-line staleness caution for an injected note, or null when fresh. Used on
 * full-text recall/injection paths (@memory, session-start, AutoRAG, memory_get).
 */
export function stalenessNote(
  updatedAt: string | undefined | null,
  now: number,
  maxAgeDays: number = DEFAULT_STALENESS_DAYS
): string | null {
  const n = staleDays(updatedAt, now, maxAgeDays);
  if (n == null) return null;
  return `⚠️ stored ${n}d ago — if this names a file, function, flag, or path, verify it still exists in the current code before relying on it.`;
}

/** Compact stale marker (`⚠Nd`) for dense list output (memory_search hits), or null when fresh. */
export function staleMarker(
  updatedAt: string | undefined | null,
  now: number,
  maxAgeDays: number = DEFAULT_STALENESS_DAYS
): string | null {
  const n = staleDays(updatedAt, now, maxAgeDays);
  return n == null ? null : `⚠${n}d`;
}
