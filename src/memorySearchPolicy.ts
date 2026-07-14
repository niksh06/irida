/**
 * Default wings excluded from agent-facing memory search (FTS, semantic, autoRag).
 * Archive wings remain in PG for forensic / explicit lookup.
 */
import {
  CURSOR_TRANSCRIPT_WING,
  EPISODIC_WING,
  DISTILL_ARCHIVE_WING,
  CLAUDE_CODE_TRANSCRIPT_WING,
  CODEX_TRANSCRIPT_WING,
} from "./memoryWings.js";
import type { MemoryConfig } from "./config.js";

/** Raw transcript archive — searchable only with includeArchive. */
export const MEMORY_ARCHIVE_WINGS = [
  CURSOR_TRANSCRIPT_WING,
  CLAUDE_CODE_TRANSCRIPT_WING,
  CODEX_TRANSCRIPT_WING,
  DISTILL_ARCHIVE_WING,
] as const;

export const SECURE_WING_NAME = "secure";

export const DEFAULT_SEARCH_EXCLUDE_WINGS: readonly string[] = [
  ...MEMORY_ARCHIVE_WINGS,
  SECURE_WING_NAME,
  EPISODIC_WING,
];

/** Wings never embedded (size + archive semantics). */
export const DEFAULT_EMBED_EXCLUDE_WINGS: readonly string[] = [...MEMORY_ARCHIVE_WINGS, SECURE_WING_NAME];

export interface MemorySearchOptions {
  /** Include archive wings (e.g. cursor-ide) in this query. */
  includeArchive?: boolean;
  /** Include episodic wing (session ingest) in this query. */
  includeEpisodic?: boolean;
  /** Extra wings to exclude for this query only. */
  excludeWings?: string[];
  /** Restrict hits to these wings (overrides default exclude for listed wings). */
  wings?: string[];
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
  let base = [...defaultExclude];
  if (opts?.includeEpisodic) {
    base = base.filter((w) => w !== EPISODIC_WING);
  }
  for (const w of opts?.excludeWings ?? []) {
    const t = w.trim();
    if (t && !base.includes(t)) base.push(t);
  }
  return base;
}

export function buildMemorySearchOptions(opts: {
  includeArchive?: boolean;
  includeEpisodic?: boolean;
  wings?: string[];
}): MemorySearchOptions | undefined {
  const wings = normalizeSearchWings(opts.wings);
  if (!opts.includeArchive && !opts.includeEpisodic && wings.length === 0) return undefined;
  return {
    ...(opts.includeArchive ? { includeArchive: true } : {}),
    ...(opts.includeEpisodic ? { includeEpisodic: true } : {}),
    ...(wings.length ? { wings } : {}),
  };
}

export function normalizeSearchWings(wings?: string[]): string[] {
  return (wings ?? []).map((w) => w.trim()).filter(Boolean);
}

/** SQLite wing filter: allow-list wins over default exclude. */
export function resolveSqliteSearchWingFilter(
  excludeWings: readonly string[],
  opts?: MemorySearchOptions
): { clause: string; params: string[] } {
  const allow = normalizeSearchWings(opts?.wings);
  if (allow.length > 0) return sqliteWingIn(allow);
  return sqliteWingNotIn(excludeWings);
}

/** Postgres wing filter: allow-list wins over default exclude. */
export function resolveSearchWingFilter(
  excludeWings: readonly string[],
  opts?: MemorySearchOptions,
  startParam = 1
): { clause: string; params: string[] } {
  const allow = normalizeSearchWings(opts?.wings);
  if (allow.length > 0) return wingInSql(allow, startParam);
  return wingNotInSql(excludeWings, startParam);
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

export function sqliteWingIn(wings: readonly string[]): { clause: string; params: string[] } {
  if (!wings.length) return { clause: "", params: [] };
  const params = [...wings];
  const placeholders = params.map(() => "?").join(", ");
  return { clause: ` AND wing IN (${placeholders})`, params };
}

export function wingInSql(wings: readonly string[], startParam = 1): {
  clause: string;
  params: string[];
} {
  if (!wings.length) return { clause: "", params: [] };
  const params = [...wings];
  const placeholders = params.map((_, i) => `$${startParam + i}`).join(", ");
  return { clause: ` AND wing IN (${placeholders})`, params };
}

export function shouldEmbedNote(wing: string, embedExclude: readonly string[]): boolean {
  return !embedExclude.includes(wing);
}
