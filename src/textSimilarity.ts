/**
 * Shared high-precision lexical near-duplicate heuristic (I-122). Extracted from
 * the evolution proposer's `isDuplicateProposal` so memory-distill can reuse the
 * same backstop. Deliberately precision-leaning: a false positive would drop a
 * DISTINCT item (the worst outcome), so it fires only on strong title overlap —
 * ≥2 shared significant tokens AND (Jaccard ≥0.6 OR coverage ≥0.8). Looser
 * semantic near-dupes are left to the LLM consolidation pass / human review.
 */
const STOPWORDS = new Set([
  "a", "an", "the", "to", "for", "of", "into", "on", "in", "and", "or", "its", "is", "with",
  "that", "when", "add", "note", "runs", "run", "irida", "gateway",
]);

/** Significant lowercased tokens of any text — title or title+body (stopwords + ≤2-char words dropped). */
export function significantTokens(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(" ")
        .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    ),
  ];
}

/**
 * High-precision near-duplicate test over two texts (titles, or title+body).
 * Both need ≥2 significant tokens and ≥2 shared; then Jaccard ≥0.6 OR coverage
 * (shared / smaller set) ≥0.8.
 */
export function isNearDuplicate(a: string, b: string): boolean {
  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (ta.length < 2 || tb.length < 2) return false;
  const aset = new Set(ta);
  const inter = tb.filter((t) => aset.has(t)).length;
  if (inter < 2) return false;
  const union = new Set([...ta, ...tb]).size;
  const jaccard = inter / union;
  const coverage = inter / Math.min(ta.length, tb.length);
  return jaccard >= 0.6 || coverage >= 0.8;
}
