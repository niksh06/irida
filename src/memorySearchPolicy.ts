/**
 * Default wings excluded from agent-facing memory search (FTS, semantic, autoRag).
 * Archive wings remain in PG for forensic / explicit lookup.
 */
import { CURSOR_TRANSCRIPT_WING } from "./memoryWings.js";
import type { MemoryConfig } from "./config.js";

/** Raw transcript archive — searchable only with includeArchive. */
export const MEMORY_ARCHIVE_WINGS = [CURSOR_TRANSCRIPT_WING] as const;

export const SECURE_WING_NAME = "secure";

export const DEFAULT_SEARCH_EXCLUDE_WINGS: readonly string[] = [
  ...MEMORY_ARCHIVE_WINGS,
  SECURE_WING_NAME,
];

/** Wings never embedded (size + archive semantics). */
export const DEFAULT_EMBED_EXCLUDE_WINGS: readonly string[] = [...MEMORY_ARCHIVE_WINGS, SECURE_WING_NAME];

export interface MemorySearchOptions {
  /** Include archive wings (e.g. cursor-ide) in this query. */
  includeArchive?: boolean;
  /** Extra wings to exclude for this query only. */
  excludeWings?: string[];
}

export function resolveSearchExcludeWings(cfg?: MemoryConfig): string[] {
  const configured = cfg?.searchExcludeWings;
  if (Array.isArray(configured) && configured.length > 0) {
    return configured.map((w) => w.trim()).filter(Boolean);
  }
  return [...DEFAULT_SEARCH_EXCLUDE_WINGS];
}

export function resolveEmbedExcludeWings(cfg?: MemoryConfig): string[] {
  const configured = cfg?.embedExcludeWings;
  if (Array.isArray(configured) && configured.length > 0) {
    return configured.map((w) => w.trim()).filter(Boolean);
  }
  return [...DEFAULT_EMBED_EXCLUDE_WINGS];
}

export function effectiveSearchExcludeWings(
  defaultExclude: readonly string[],
  opts?: MemorySearchOptions
): string[] {
  if (opts?.includeArchive) {
    const extra = opts.excludeWings?.map((w) => w.trim()).filter(Boolean) ?? [];
    return extra.length ? extra : [];
  }
  const base = [...defaultExclude];
  for (const w of opts?.excludeWings ?? []) {
    const t = w.trim();
    if (t && !base.includes(t)) base.push(t);
  }
  return base;
}

export function filterNotesByWings<T extends { wing: string }>(
  notes: T[],
  excludeWings: readonly string[]
): T[] {
  if (!excludeWings.length) return notes;
  const blocked = new Set(excludeWings);
  return notes.filter((n) => !blocked.has(n.wing));
}

export function wingNotInSql(excludeWings: readonly string[], startParam = 1): {
  clause: string;
  params: string[];
} {
  if (!excludeWings.length) return { clause: "", params: [] };
  const params = [...excludeWings];
  const placeholders = params.map((_, i) => `$${startParam + i}`).join(", ");
  return { clause: ` AND wing NOT IN (${placeholders})`, params };
}

export function sqliteWingNotIn(excludeWings: readonly string[]): { clause: string; params: string[] } {
  if (!excludeWings.length) return { clause: "", params: [] };
  const params = [...excludeWings];
  const placeholders = params.map(() => "?").join(", ");
  return { clause: ` AND wing NOT IN (${placeholders})`, params };
}

export function shouldEmbedNote(wing: string, embedExclude: readonly string[]): boolean {
  return !embedExclude.includes(wing);
}
