/**
 * Local embeddings (I-36) via one of two HTTP shapes (I-131):
 *  - "ollama":        POST /api/embeddings {model,prompt} → {embedding}
 *  - "embed-service": POST /embed {text} → {vector}  (sentence-transformers µ-service)
 * Fail-soft: any error / wrong-dim returns null — memory saves must never depend
 * on the embedding service being up (the reindex cron backfills misses).
 */
import type { EmbeddingsConfig } from "./config.js";

export const EMBEDDINGS_DEFAULT_URL = "http://127.0.0.1:11434";
export const EMBEDDINGS_DEFAULT_MODEL = "nomic-embed-text";
/** pgvector column is fixed to this; both nomic and multilingual-mpnet are 768-dim. */
export const EMBEDDINGS_DIM = 768;
/** Keep prompts well under model context; notes are chunk-free v1. */
const EMBED_MAX_CHARS = 8000;
/** Bound each embed call — a wedged service must not hang upsertNote (I-142). */
const EMBED_TIMEOUT_MS = 10_000;

export type EmbedFn = (text: string) => Promise<number[] | null>;

export function embeddingsEnabled(cfg?: EmbeddingsConfig): boolean {
  return cfg?.enabled === true;
}

function validVec(emb: unknown): number[] | null {
  if (!Array.isArray(emb) || emb.length !== EMBEDDINGS_DIM) return null;
  if (!emb.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  return emb as number[];
}

/** Build an embedder for the configured provider; null result = skip silently. */
export function makeEmbedder(
  cfg: EmbeddingsConfig | undefined,
  fetchFn: typeof fetch = fetch
): EmbedFn | undefined {
  if (!embeddingsEnabled(cfg)) return undefined;
  const url = (cfg?.url ?? EMBEDDINGS_DEFAULT_URL).replace(/\/$/, "");
  const provider = cfg?.provider ?? "ollama";
  const model = cfg?.model ?? EMBEDDINGS_DEFAULT_MODEL;
  return async (text: string): Promise<number[] | null> => {
    const input = text.trim().slice(0, EMBED_MAX_CHARS);
    if (!input) return null;
    const endpoint = provider === "embed-service" ? `${url}/embed` : `${url}/api/embeddings`;
    const payload = provider === "embed-service" ? { text: input } : { model, prompt: input };
    try {
      // Fail-soft covers errors; the timeout covers a service that accepts
      // the connection and never answers (I-142).
      const res = await fetchFn(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { embedding?: unknown; vector?: unknown };
      return validVec(provider === "embed-service" ? body.vector : body.embedding);
    } catch {
      return null;
    }
  };
}

/** pgvector literal: '[0.1,0.2,…]'. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
