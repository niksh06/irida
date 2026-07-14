/**
 * Map-reduce cursor-lesson distill orchestrator (I-65b).
 * Map/reduce subagents always use composer-2.5-fast.
 */
import { loadConfig } from "./config.js";
import { CURSOR_DISTILL_SUBAGENT_MODEL, assertDistillSubagentModel, resolveDistillSubagentModel } from "./cursorDistillModel.js";
import {
  buildCursorDistillQueue,
  cursorLessonNoteName,
  ensureOkfLessonDocument,
  formatLessonHeader,
  MAX_LESSON_BODY_BYTES,
  validateLessonBodySize,
  type DistillCandidate,
} from "./cursorTranscriptDistill.js";
import { resolveArchiveContentHash } from "./cursorTranscriptMine.js";
import { CURSOR_LESSON_WING } from "./memoryWings.js";
import { createMemoryStore } from "./memoryStore.js";
import { splitTranscriptForDistill, type TranscriptChunk } from "./cursorTranscriptSplit.js";
import { runPrompt, type RunOptions, type RunResult } from "./run.js";
import type { SdkLike } from "./host.js";

export interface DistillOrchestratorOptions {
  dir: string;
  /** Transcripts per batch (default 10). */
  limit?: number;
  /** Concurrent SDK map calls per transcript (default 3). */
  parallel?: number;
  force?: boolean;
  backfill?: boolean;
  minBodyBytes?: number;
  dryRun?: boolean;
  sdk?: SdkLike;
  /** Test hook — defaults to runPrompt. */
  runFn?: (prompt: string, opts: RunOptions) => Promise<RunResult>;
  /** Wing to scan for source transcripts (default cursor-ide). */
  archiveWing?: string;
  /** Wing to save distilled lessons into (default cursor-lesson). */
  lessonWing?: string;
}

export interface DistillTranscriptResult {
  sourceName: string;
  lessonName: string;
  ok: boolean;
  chunks: number;
  message: string;
}

export interface DistillBatchResult {
  processed: number;
  saved: number;
  failed: number;
  results: DistillTranscriptResult[];
}

const SUBAGENT_OPTS = {
  barePrompt: true,
  persistRun: false,
  quiet: true,
  /** Archive chunks often mention git/rm — controlled batch job. */
  yesIUnderstand: true,
} as const;

function chunkPrompt(chunk: TranscriptChunk, title: string): string {
  return `Distill this Cursor IDE chat fragment into partial notes (markdown only, no tools).

Title: ${title}
Fragment ${chunk.index + 1}/${chunk.total}

Sections (omit empty):
- Summary (bullets)
- Decisions
- Playbook snippets
- Friction

---
${chunk.text}
---`;
}

function mergePrompt(
  source: string,
  sourceHash: string | undefined,
  title: string,
  partials: string[],
  lessonWing?: string
): string {
  const header = formatLessonHeader({
    source,
    sourceHash,
    status: "proposal",
    title,
    lessonName: cursorLessonNoteName(source),
    lessonWing,
  });
  const joined = partials
    .map((p, i) => `### Partial ${i + 1}\n${p.trim()}`)
    .join("\n\n");
  return `Merge these partial distill notes from one Cursor IDE chat into ONE lesson note.

Hard limits:
- Start with OKF YAML frontmatter (type: Playbook, source, sourceHash, status: proposal) — see deploy/prompts/cursor-lesson.template.md
- Example frontmatter opener:
${header}
- Total body ≤ ${MAX_LESSON_BODY_BYTES} bytes
- Body sections in order: Summary, Decisions, Playbook (or Steps), Friction
- Compress duplicates; no transcript paste; redact secrets

Source title: ${title}

Partials:

${joined}

Output the final lesson markdown only.`;
}

function singleChunkLessonPrompt(
  source: string,
  sourceHash: string | undefined,
  title: string,
  chunk: TranscriptChunk,
  lessonWing?: string
): string {
  const header = formatLessonHeader({
    source,
    sourceHash,
    status: "proposal",
    title,
    lessonName: cursorLessonNoteName(source),
    lessonWing,
  });
  return `Distill this Cursor IDE chat into ONE compact lesson note.

Hard limits:
- Start with OKF YAML frontmatter (type: Playbook, source, sourceHash, status: proposal) — see deploy/prompts/cursor-lesson.template.md
- Example frontmatter opener:
${header}
- Total body ≤ ${MAX_LESSON_BODY_BYTES} bytes
- Body sections in order: Summary, Decisions, Playbook (or Steps), Friction
- No transcript paste; redact secrets

Title: ${title}

---
${chunk.text}
---`;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Math.min(Math.max(1, concurrency), items.length);
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

async function runSubagent(
  prompt: string,
  dir: string,
  model: string,
  sdk: SdkLike | undefined,
  runFn: (prompt: string, opts: RunOptions) => Promise<RunResult>
): Promise<string> {
  const out = await runFn(prompt, { dir, sdk, ...SUBAGENT_OPTS, model });
  if (out.exitCode !== 0 || !out.text.trim()) {
    const hint = out.text.trim() || `subagent exit ${out.exitCode}`;
    throw new Error(hint);
  }
  return out.text.trim();
}

function wrapLessonBody(
  body: string,
  candidate: DistillCandidate,
  sourceHash: string | undefined,
  lessonWing?: string
): string {
  return ensureOkfLessonDocument(body, {
    source: candidate.sourceName,
    sourceHash,
    lessonName: candidate.lessonName,
    title: candidate.title,
    lessonWing,
  });
}

function truncateLessonBody(body: string, maxBytes: number): string {
  if (Buffer.byteLength(body, "utf8") <= maxBytes) return body;
  const lines = body.split("\n");
  let inFrontmatter = false;
  let frontmatterDone = false;
  let acc = "";
  for (const line of lines) {
    if (!frontmatterDone) {
      if (line.trim() === "---" && !inFrontmatter) {
        inFrontmatter = true;
        acc = acc ? `${acc}\n${line}` : line;
        continue;
      }
      if (line.trim() === "---" && inFrontmatter) {
        frontmatterDone = true;
        acc = `${acc}\n${line}`;
        continue;
      }
      acc = acc ? `${acc}\n${line}` : line;
      continue;
    }
    const candidate = acc ? `${acc}\n${line}` : line;
    if (Buffer.byteLength(candidate, "utf8") > maxBytes - 32) break;
    acc = candidate;
  }
  return `${acc.trim()}\n\n<!-- truncated to ${maxBytes} bytes -->`;
}

export async function distillOneTranscript(
  dir: string,
  candidate: DistillCandidate,
  archiveBody: string,
  opts: Pick<DistillOrchestratorOptions, "parallel" | "sdk" | "runFn" | "dryRun" | "lessonWing"> = {}
): Promise<{ body: string; chunks: number }> {
  const runFn = opts.runFn ?? runPrompt;
  const parallel = Math.max(1, opts.parallel ?? 3);
  const model =
    opts.runFn || opts.dryRun ? resolveDistillSubagentModel() : await assertDistillSubagentModel(dir);
  const sourceHash = candidate.sourceHash ?? resolveArchiveContentHash(archiveBody);
  const chunks = splitTranscriptForDistill(archiveBody);
  if (!chunks.length) {
    throw new Error("empty archive body");
  }

  if (opts.dryRun) {
    return { body: "", chunks: chunks.length };
  }

  let lessonBody: string;
  if (chunks.length === 1) {
    lessonBody = await runSubagent(
      singleChunkLessonPrompt(candidate.sourceName, sourceHash, candidate.title, chunks[0]!, opts.lessonWing),
      dir,
      model,
      opts.sdk,
      runFn
    );
  } else {
    const partials = await mapPool(chunks, parallel, (chunk) =>
      runSubagent(chunkPrompt(chunk, candidate.title), dir, model, opts.sdk, runFn)
    );
    lessonBody = await runSubagent(
      mergePrompt(candidate.sourceName, sourceHash, candidate.title, partials, opts.lessonWing),
      dir,
      model,
      opts.sdk,
      runFn
    );
  }

  lessonBody = wrapLessonBody(lessonBody, candidate, sourceHash, opts.lessonWing);
  if (!validateLessonBodySize(lessonBody)) {
    lessonBody = truncateLessonBody(lessonBody, MAX_LESSON_BODY_BYTES);
  }
  return { body: lessonBody, chunks: chunks.length };
}

export async function runCursorDistillBatch(opts: DistillOrchestratorOptions): Promise<DistillBatchResult> {
  loadConfig(opts.dir);
  if (!opts.dryRun && !opts.runFn) {
    try {
      await assertDistillSubagentModel(opts.dir);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        processed: 0,
        saved: 0,
        failed: 1,
        results: [
          {
            sourceName: "—",
            lessonName: "—",
            ok: false,
            chunks: 0,
            message: msg,
          },
        ],
      };
    }
  }
  const queue = await buildCursorDistillQueue(opts.dir, {
    limit: opts.limit ?? 10,
    force: opts.force,
    minBodyBytes: opts.minBodyBytes,
    backfill: opts.backfill,
    archiveWing: opts.archiveWing,
  });

  const memory = createMemoryStore(opts.dir);
  const results: DistillTranscriptResult[] = [];
  let saved = 0;
  let failed = 0;

  try {
    for (const candidate of queue.candidates) {
      const archive = await memory.getNote(candidate.sourceName);
      if (!archive?.body?.trim()) {
        failed++;
        results.push({
          sourceName: candidate.sourceName,
          lessonName: candidate.lessonName,
          ok: false,
          chunks: 0,
          message: "archive note missing",
        });
        continue;
      }

      try {
        const { body, chunks } = await distillOneTranscript(opts.dir, candidate, archive.body, {
          parallel: opts.parallel,
          sdk: opts.sdk,
          runFn: opts.runFn,
          dryRun: opts.dryRun,
          lessonWing: opts.lessonWing,
        });

        if (opts.dryRun) {
          results.push({
            sourceName: candidate.sourceName,
            lessonName: candidate.lessonName,
            ok: true,
            chunks,
            message: `dry-run: ${chunks} chunk(s)`,
          });
          continue;
        }

        await memory.upsertNote({
          name: candidate.lessonName,
          wing: opts.lessonWing ?? CURSOR_LESSON_WING,
          title: candidate.title.replace(/^Cursor chat /, "Lesson: ") || candidate.lessonName,
          body,
        });
        saved++;
        results.push({
          sourceName: candidate.sourceName,
          lessonName: candidate.lessonName,
          ok: true,
          chunks,
          message: "saved",
        });
      } catch (e) {
        failed++;
        results.push({
          sourceName: candidate.sourceName,
          lessonName: candidate.lessonName,
          ok: false,
          chunks: 0,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } finally {
    await memory.close();
  }

  return {
    processed: results.length,
    saved,
    failed,
    results,
  };
}

export { CURSOR_DISTILL_SUBAGENT_MODEL, resolveDistillSubagentModel };
