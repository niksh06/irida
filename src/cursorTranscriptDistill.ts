/**
 * Cursor IDE transcript distill queue (I-65) — compressed lessons from archive wing.
 */
import { loadConfig } from "./config.js";
import { resolveArchiveContentHash } from "./cursorTranscriptMine.js";
import {
  archiveIsDelta,
  loadCursorDistillBaseline,
  saveCursorDistillBaseline,
  type CursorDistillBaseline,
} from "./cursorDistillBaseline.js";
import { CURSOR_TRANSCRIPT_WING, CURSOR_LESSON_WING } from "./memoryWings.js";
import { createMemoryStore, type IMemoryStore, type MemoryNote } from "./memoryStore.js";
import {
  migrateLessonBodyToOkf,
  okfMemoryResource,
  OKF_VERSION,
  parseLessonLineage,
  parseOkfDocument,
  serializeOkfDocument,
  type OkfFrontmatter,
} from "./okf.js";

export { CURSOR_LESSON_WING } from "./memoryWings.js";
export { parseLessonLineage } from "./okf.js";

/** @deprecated Legacy HTML comment — use OKF frontmatter; kept for stale-hash reads. */
const CURSOR_LESSON_META_RE =
  /<!-- csagent cursor-lesson; source=([^;\s]+)(?:;\s*sourceHash=([a-f0-9]+))?(?:;\s*status=([^;\s]+))?/;

export interface CursorLessonMeta {
  source?: string;
  sourceHash?: string;
  status?: string;
}

/** Target size for distilled lesson notes (~4 KiB). */
export const MAX_LESSON_BODY_BYTES = 4096;

export interface DistillCandidate {
  sourceName: string;
  lessonName: string;
  title: string;
  bodyBytes: number;
  sourceHash?: string;
  reason: "missing" | "stale";
}

export interface CursorDistillQueueResult {
  candidates: DistillCandidate[];
  skipped: number;
  /** Active baseline (delta mode only). */
  baseline?: CursorDistillBaseline;
  mode: "backfill" | "delta";
}

export interface CursorDistillQueueOptions {
  /** Max transcripts to return (default 10). */
  limit?: number;
  /** Re-queue even when lesson sourceHash matches archive hash. */
  force?: boolean;
  /** Skip archive notes smaller than this (default 0). */
  minBodyBytes?: number;
  /** Ignore baseline — queue all stale/missing (one-time backfill). */
  backfill?: boolean;
  /** Wing to scan for source transcripts (default cursor-ide). */
  archiveWing?: string;
}

/** Map `cursor.<uuid>` → `lesson.<uuid>`. */
export function cursorLessonNoteName(sourceName: string): string {
  const trimmed = sourceName.trim();
  if (trimmed.startsWith("cursor.")) {
    return `lesson.${trimmed.slice("cursor.".length)}`;
  }
  const base = `lesson.${trimmed}`.slice(0, 64);
  return base;
}

export function parseCursorLessonMeta(body: string | undefined): CursorLessonMeta {
  return parseLessonLineage(body);
}

/** Legacy HTML-only parse (tests / migration). */
export function parseLegacyLessonHtmlMeta(body: string | undefined): CursorLessonMeta {
  if (!body) return {};
  const m = body.match(CURSOR_LESSON_META_RE);
  if (!m) return {};
  return { source: m[1], sourceHash: m[2], status: m[3] };
}

export function lessonNeedsRefresh(
  archiveBody: string | undefined,
  lessonBody: string | undefined,
  force: boolean
): { needs: boolean; reason?: "missing" | "stale"; sourceHash?: string } {
  if (force || !lessonBody?.trim()) {
    return {
      needs: true,
      reason: lessonBody?.trim() ? "stale" : "missing",
      sourceHash: resolveArchiveContentHash(archiveBody),
    };
  }
  const archiveHash = resolveArchiveContentHash(archiveBody);
  const lesson = parseCursorLessonMeta(lessonBody);
  if (!archiveHash) return { needs: false, sourceHash: archiveHash };
  if (!lesson.sourceHash || lesson.sourceHash !== archiveHash) {
    return { needs: true, reason: "stale", sourceHash: archiveHash };
  }
  return { needs: false, sourceHash: archiveHash };
}

export function validateLessonBodySize(body: string, maxBytes = MAX_LESSON_BODY_BYTES): boolean {
  return Buffer.byteLength(body, "utf8") <= maxBytes;
}

export function formatLessonHeader(opts: {
  source: string;
  sourceHash?: string;
  status?: "proposal" | "approved";
  title?: string;
  lessonName?: string;
  /** Wing to save the distilled lesson into (default cursor-lesson). */
  lessonWing?: string;
}): string {
  const lessonWing = opts.lessonWing ?? CURSOR_LESSON_WING;
  const fm: OkfFrontmatter = {
    type: "Playbook",
    title: opts.title ?? opts.source,
    description: `Distilled playbook from ${opts.source}`,
    resource: okfMemoryResource(opts.lessonName ?? cursorLessonNoteName(opts.source)),
    tags: ["csagent", "cursor-lesson"],
    okf_version: OKF_VERSION,
    wing: lessonWing,
    status: opts.status ?? "proposal",
    source: opts.source,
    sourceHash: opts.sourceHash,
  };
  return serializeOkfDocument(fm, "").trimEnd();
}

/** Wrap lesson body with OKF frontmatter (idempotent). */
export function ensureOkfLessonDocument(
  body: string,
  opts: {
    source: string;
    sourceHash?: string;
    status?: "proposal" | "approved";
    lessonName: string;
    title?: string;
    updatedAt?: string;
    /** Wing to save the distilled lesson into (default cursor-lesson). */
    lessonWing?: string;
  }
): string {
  const lineage = parseLessonLineage(body);
  if (lineage.source && parseOkfDocument(body)) {
    return body.trim();
  }
  const lessonWing = opts.lessonWing ?? CURSOR_LESSON_WING;
  const migrated = migrateLessonBodyToOkf({
    name: opts.lessonName,
    wing: lessonWing,
    body,
    updatedAt: opts.updatedAt,
  });
  const doc = parseOkfDocument(migrated);
  if (!doc) return migrated;
  const fm: OkfFrontmatter = {
    ...doc.frontmatter,
    source: opts.source,
    sourceHash: opts.sourceHash ?? doc.frontmatter.sourceHash,
    status: opts.status ?? doc.frontmatter.status ?? "proposal",
    resource: okfMemoryResource(opts.lessonName),
  };
  return serializeOkfDocument(fm, doc.body);
}

export async function listTranscriptsNeedingDistill(
  memory: IMemoryStore,
  opts: CursorDistillQueueOptions = {},
  baseline?: CursorDistillBaseline
): Promise<CursorDistillQueueResult> {
  const limit = Math.max(1, opts.limit ?? 10);
  const force = opts.force === true;
  const minBodyBytes = Math.max(0, opts.minBodyBytes ?? 0);
  const backfill = opts.backfill === true;
  const mode = backfill ? "backfill" : "delta";
  const archiveWing = opts.archiveWing?.trim() || CURSOR_TRANSCRIPT_WING;

  const archiveNotes = await memory.listNotes(archiveWing);
  const candidates: DistillCandidate[] = [];
  let skipped = 0;

  for (const note of archiveNotes) {
    if (!backfill && !archiveIsDelta(note.updated_at, baseline)) {
      skipped++;
      continue;
    }
    const bodyBytes = Buffer.byteLength(note.body ?? "", "utf8");
    if (bodyBytes < minBodyBytes) {
      skipped++;
      continue;
    }
    const lessonName = cursorLessonNoteName(note.name);
    const lesson = await memory.getNote(lessonName);
    const check = lessonNeedsRefresh(note.body, lesson?.body, force);
    if (!check.needs || !check.reason) {
      skipped++;
      continue;
    }
    candidates.push({
      sourceName: note.name,
      lessonName,
      title: note.title ?? note.name,
      bodyBytes,
      sourceHash: check.sourceHash,
      reason: check.reason,
    });
  }

  candidates.sort((a, b) => b.bodyBytes - a.bodyBytes);
  return {
    candidates: candidates.slice(0, limit),
    skipped,
    baseline: backfill ? undefined : baseline,
    mode,
  };
}

export function formatDistillQueueMarkdown(
  result: CursorDistillQueueResult,
  opts: { lessonWing?: string } = {}
): string {
  const lessonWing = opts.lessonWing ?? CURSOR_LESSON_WING;
  if (!result.candidates.length) {
    const modeHint =
      result.mode === "delta" && result.baseline
        ? ` (delta since ${result.baseline.baselineAt})`
        : result.mode === "backfill"
          ? " (backfill)"
          : "";
    return `No cursor-ide transcripts need distill (queue empty${modeHint}).`;
  }
  const lines = [
    "# Cursor distill queue",
    "",
    `Mode: **${result.mode}**` +
      (result.baseline ? ` · delta since \`${result.baseline.baselineAt}\`` : ""),
    "",
    `Candidates: ${result.candidates.length} (skipped ${result.skipped} up to date, below threshold, or outside delta)`,
    "",
    "| Priority | Source | Lesson name | Size | Reason | sourceHash |",
    "|----------|--------|-------------|------|--------|------------|",
  ];
  for (let i = 0; i < result.candidates.length; i++) {
    const c = result.candidates[i]!;
    const kb = c.bodyBytes >= 1024 ? `${(c.bodyBytes / 1024).toFixed(1)} KiB` : `${c.bodyBytes} B`;
    lines.push(
      `| ${i + 1} | ${c.sourceName} | ${c.lessonName} | ${kb} | ${c.reason} | ${c.sourceHash ?? "—"} |`
    );
  }
  lines.push("", `Read each source with \`memory_get\`. Save lessons to wing \`${lessonWing}\`.`);
  lines.push(
    "",
    "**Upsert rule:** use the **Lesson name** column exactly. When Reason=`stale`, overwrite that note — never create a second name for the same source.",
    "",
    "**Facts (optional, ≤3):** after `memory_save`, call `memory_fact_add` with subject `cursor_lesson`, predicate = lesson name, object = one durable decision (≤200 chars)."
  );
  return lines.join("\n");
}

export function formatDistillQueueJson(result: CursorDistillQueueResult): string {
  return JSON.stringify(result, null, 2);
}

export async function buildCursorDistillQueue(
  dir: string,
  opts: CursorDistillQueueOptions = {}
): Promise<CursorDistillQueueResult> {
  loadConfig(dir);
  const baseline = opts.backfill ? undefined : loadCursorDistillBaseline(dir);
  const memory = createMemoryStore(dir);
  try {
    return await listTranscriptsNeedingDistill(memory, opts, baseline);
  } finally {
    await memory.close();
  }
}

export { loadCursorDistillBaseline, saveCursorDistillBaseline } from "./cursorDistillBaseline.js";
export type { CursorDistillBaseline } from "./cursorDistillBaseline.js";

/** Resolve archive note for a lesson (best-effort). */
export function sourceNameFromLesson(lesson: MemoryNote): string | undefined {
  const meta = parseCursorLessonMeta(lesson.body);
  if (meta.source) return meta.source;
  if (lesson.name.startsWith("lesson.")) {
    return `cursor.${lesson.name.slice("lesson.".length)}`;
  }
  return undefined;
}
