/** Weighted reciprocal rank fusion for FTS + vector lists (I-72). */

export const RRF_K = 60;

export interface HybridSearchWeights {
  fts: number;
  vector: number;
}

export const DEFAULT_HYBRID_WEIGHTS: HybridSearchWeights = { fts: 1, vector: 1 };

export function resolveHybridWeights(raw?: {
  fts?: number;
  vector?: number;
}): HybridSearchWeights {
  const fts = typeof raw?.fts === "number" && raw.fts > 0 ? raw.fts : DEFAULT_HYBRID_WEIGHTS.fts;
  const vector =
    typeof raw?.vector === "number" && raw.vector > 0 ? raw.vector : DEFAULT_HYBRID_WEIGHTS.vector;
  return { fts, vector };
}

export function reciprocalRankFusion<T extends { name: string }>(
  rankedLists: Array<{ items: T[]; weight: number }>,
  limit: number,
  k = RRF_K
): T[] {
  const scores = new Map<string, { score: number; item: T }>();
  for (const { items, weight } of rankedLists) {
    for (let rank = 0; rank < items.length; rank++) {
      const item = items[rank]!;
      const add = weight / (k + rank + 1);
      const prev = scores.get(item.name);
      if (prev) prev.score += add;
      else scores.set(item.name, { score: add, item });
    }
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, limit)
    .map((v) => v.item);
}
