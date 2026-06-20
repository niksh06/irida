/**
 * cursor-lesson paired eval scaffold (I-79) — HITL sheet + eval facts, no live SDK in CI.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.js";
import { createMemoryStore } from "./memoryStore.js";
import { loadPromoteLessonNames } from "./memoryOkf.js";
import { parseOkfDocument } from "./okf.js";

export const CURSOR_LESSON_EVAL_SUBJECT = "cursor_lesson_eval";

export const LESSON_EVAL_VERDICTS = ["pass", "fail", "neutral"] as const;
export type LessonEvalVerdict = (typeof LESSON_EVAL_VERDICTS)[number];

export interface LessonEvalTask {
  id: string;
  lesson: string;
  prompt: string;
  rubric: string;
}

export interface LessonEvalTasksFile {
  version: number;
  tasks: LessonEvalTask[];
}

export interface LessonEvalValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function defaultLessonEvalTasksPath(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "../eval/cases/cursor-lesson-paired/tasks.json"
  );
}

export function loadLessonEvalTasks(tasksPath?: string): LessonEvalTasksFile {
  const path = tasksPath ?? defaultLessonEvalTasksPath();
  if (!existsSync(path)) {
    throw new Error(`lesson eval tasks missing: ${path}`);
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<LessonEvalTasksFile>;
  if (!Array.isArray(raw.tasks)) {
    throw new Error(`${path}: tasks must be an array`);
  }
  const tasks: LessonEvalTask[] = [];
  for (const row of raw.tasks) {
    if (row == null || typeof row !== "object" || Array.isArray(row)) continue;
    const o = row as unknown as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const lesson = typeof o.lesson === "string" ? o.lesson.trim() : "";
    const prompt = typeof o.prompt === "string" ? o.prompt.trim() : "";
    const rubric = typeof o.rubric === "string" ? o.rubric.trim() : "";
    if (!id || !lesson || !prompt || !rubric) continue;
    tasks.push({ id, lesson, prompt, rubric });
  }
  if (!tasks.length) throw new Error(`${path}: no valid tasks`);
  return { version: typeof raw.version === "number" ? raw.version : 1, tasks };
}

export function validateLessonEvalTasks(
  tasksFile: LessonEvalTasksFile,
  promoteNames: string[]
): LessonEvalValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const promote = new Set(promoteNames);
  if (tasksFile.tasks.length < 5) {
    errors.push(`need ≥5 tasks, got ${tasksFile.tasks.length}`);
  }
  const ids = new Set<string>();
  const lessons = new Set<string>();
  for (const t of tasksFile.tasks) {
    if (ids.has(t.id)) errors.push(`duplicate task id: ${t.id}`);
    ids.add(t.id);
    if (lessons.has(t.lesson)) errors.push(`duplicate lesson in tasks: ${t.lesson}`);
    lessons.add(t.lesson);
    if (!promote.has(t.lesson)) {
      errors.push(`task ${t.id}: lesson ${t.lesson} not in promote list`);
    }
  }
  for (const name of promoteNames) {
    if (!lessons.has(name)) {
      warnings.push(`promote lesson has no eval task: ${name}`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function validateLessonEvalScaffold(
  configDir: string,
  opts: { promoteFile?: string; tasksPath?: string } = {}
): LessonEvalValidationResult {
  const promoteNames = loadPromoteLessonNames(configDir, opts.promoteFile);
  const tasksFile = loadLessonEvalTasks(opts.tasksPath);
  return validateLessonEvalTasks(tasksFile, promoteNames);
}

export function parseLessonEvalVerdict(raw: string): LessonEvalVerdict | undefined {
  const v = raw.trim().toLowerCase();
  return LESSON_EVAL_VERDICTS.includes(v as LessonEvalVerdict)
    ? (v as LessonEvalVerdict)
    : undefined;
}

export function formatLessonEvalFactObject(verdict: LessonEvalVerdict, note?: string): string {
  const trimmed = note?.trim();
  if (!trimmed) return verdict;
  return `${verdict}: ${trimmed.slice(0, 180)}`;
}

export interface LessonEvalRow {
  task: LessonEvalTask;
  title?: string;
  verdict?: string;
  verdictAt?: string;
}

export async function buildLessonEvalRows(
  dir: string,
  opts: { promoteFile?: string; tasksPath?: string } = {}
): Promise<LessonEvalRow[]> {
  loadConfig(dir);
  const promoteNames = loadPromoteLessonNames(dir, opts.promoteFile);
  const tasksFile = loadLessonEvalTasks(opts.tasksPath);
  const validation = validateLessonEvalTasks(tasksFile, promoteNames);
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }
  const store = createMemoryStore(dir);
  try {
    const facts = await store.queryFacts({ subject: CURSOR_LESSON_EVAL_SUBJECT });
    const byLesson = new Map<string, { object: string; valid_from?: string }>();
    for (const f of facts) {
      byLesson.set(f.predicate, { object: f.object, valid_from: f.valid_from ?? undefined });
    }
    const rows: LessonEvalRow[] = [];
    for (const task of tasksFile.tasks) {
      const note = await store.getNote(task.lesson);
      let title: string | undefined;
      if (note?.body) {
        const doc = parseOkfDocument(note.body);
        title = doc?.frontmatter.title?.trim() || note.title?.trim();
      }
      const evalFact = byLesson.get(task.lesson);
      rows.push({
        task,
        title,
        verdict: evalFact?.object,
        verdictAt: evalFact?.valid_from,
      });
    }
    return rows;
  } finally {
    await store.close();
  }
}

export function formatLessonEvalSheet(rows: LessonEvalRow[]): string {
  const lines = [
    "# cursor-lesson paired eval (I-79)",
    "",
    "Run each task **twice** in a fresh agent session:",
    "",
    "1. **Baseline (A)** — no lesson injection; only repo + default skills.",
    "2. **With lesson (B)** — `memory_get` the lesson (or `@memory:<lesson>`) before the task prompt.",
    "3. Score **lift**: did B materially improve outcome vs A? Record via `irida memory lesson-eval record`.",
    "",
    "| # | lesson | title | task | rubric | verdict |",
    "|---|--------|-------|------|--------|---------|",
  ];
  rows.forEach((row, i) => {
    const title = (row.title ?? "—").replace(/\|/g, "\\|").slice(0, 60);
    const prompt = row.task.prompt.replace(/\|/g, "\\|").slice(0, 80);
    const rubric = row.task.rubric.replace(/\|/g, "\\|").slice(0, 60);
    const verdict = row.verdict?.split(":")[0]?.trim() ?? "—";
    lines.push(`| ${i + 1} | \`${row.task.lesson}\` | ${title} | ${prompt} | ${rubric} | ${verdict} |`);
  });
  lines.push("", "## Prompts (copy-paste)", "");
  for (const row of rows) {
    lines.push(`### ${row.task.id} — \`${row.task.lesson}\``);
    if (row.title) lines.push(`**Title:** ${row.title}`);
    lines.push("", "**Task prompt:**", "", row.task.prompt, "", "**Rubric:**", "", row.task.rubric, "");
  }
  return lines.join("\n");
}

export async function recordLessonEval(
  dir: string,
  lesson: string,
  verdict: LessonEvalVerdict,
  note?: string
): Promise<{ id: string; object: string }> {
  loadConfig(dir);
  const name = lesson.trim();
  if (!name.startsWith("lesson.")) {
    throw new Error(`lesson name must start with lesson. (got ${JSON.stringify(name)})`);
  }
  const object = formatLessonEvalFactObject(verdict, note);
  const store = createMemoryStore(dir);
  try {
    const existing = await store.queryFacts({
      subject: CURSOR_LESSON_EVAL_SUBJECT,
      predicate: name,
    });
    for (const f of existing) {
      await store.invalidateFact(f.id);
    }
    const fact = await store.addFact({
      subject: CURSOR_LESSON_EVAL_SUBJECT,
      predicate: name,
      object,
    });
    return { id: fact.id, object: fact.object };
  } finally {
    await store.close();
  }
}

export interface LessonEvalSummaryRow {
  lesson: string;
  verdict?: LessonEvalVerdict;
  detail?: string;
  taskId?: string;
}

export async function summarizeLessonEval(
  dir: string,
  opts: { promoteFile?: string; tasksPath?: string } = {}
): Promise<{ rows: LessonEvalSummaryRow[]; archiveCandidates: string[] }> {
  const rows = await buildLessonEvalRows(dir, opts);
  const summary: LessonEvalSummaryRow[] = rows.map((r) => {
    const base = r.verdict?.split(":")[0]?.trim().toLowerCase();
    const verdict = parseLessonEvalVerdict(base ?? "");
    return {
      lesson: r.task.lesson,
      verdict,
      detail: r.verdict,
      taskId: r.task.id,
    };
  });
  const archiveCandidates = summary
    .filter((r) => r.verdict === "fail")
    .map((r) => r.lesson);
  return { rows: summary, archiveCandidates };
}

export function resolveLessonEvalOutPath(dir: string, out: string): string {
  return isAbsolute(out) ? out : resolve(dir, out);
}

export async function writeLessonEvalSheet(
  dir: string,
  outPath: string,
  opts: { promoteFile?: string; tasksPath?: string } = {}
): Promise<string> {
  const rows = await buildLessonEvalRows(dir, opts);
  const md = formatLessonEvalSheet(rows);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, md, "utf8");
  return md;
}
