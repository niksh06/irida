/**
 * Local embeddings via an Ollama-compatible API (I-36).
 * Fail-soft: any error returns null — memory saves must never depend on the
 * embedding daemon being up.
 */
import type { EmbeddingsConfig } from "./config.js";

export const EMBEDDINGS_DEFAULT_URL = "http://127.0.0.1:11434";
export const EMBEDDINGS_DEFAULT_MODEL = "nomic-embed-text";
/** nomic-embed-text dimension; pgvector column is fixed to this. */
export const EMBEDDINGS_DIM = 768;
/** Keep prompts well under model context; notes are chunk-free v1. */
const EMBED_MAX_CHARS = 8000;

export type EmbedFn = (text: string) => Promise<number[] | null>;

export function embeddingsEnabled(cfg?: EmbeddingsConfig): boolean {
  return cfg?.enabled === true;
}

/** Build an embedder for the configured provider; null result = skip silently. */
export function makeEmbedder(
  cfg: EmbeddingsConfig | undefined,
  fetchFn: typeof fetch = fetch
): EmbedFn | undefined {
  if (!embeddingsEnabled(cfg)) return undefined;
  const url = (cfg?.url ?? EMBEDDINGS_DEFAULT_URL).replace(/\/$/, "");
  const model = cfg?.model ?? EMBEDDINGS_DEFAULT_MODEL;
  return async (text: string): Promise<number[] | null> => {
    const prompt = text.trim().slice(0, EMBED_MAX_CHARS);
    if (!prompt) return null;
    try {
      const res = await fetchFn(`${url}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { embedding?: unknown };
      const emb = body.embedding;
      if (!Array.isArray(emb) || emb.length !== EMBEDDINGS_DIM) return null;
      if (!emb.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
      return emb as number[];
    } catch {
      return null;
    }
  };
}

/** pgvector literal: '[0.1,0.2,…]'. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
