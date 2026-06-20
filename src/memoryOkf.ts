/**
 * OKF audit, migration, review export, bundle export, and hygiene for irida memory notes.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { CURSOR_LESSON_WING } from "./memoryWings.js";
import { saveMemory } from "./memory.js";
import {
  hasLegacyLessonHtmlMeta,
  isOkfDocument,
  migrateLessonBodyToOkf,
  parseLessonLineage,
  parseOkfDocument,
  patchLessonStatus,
  serializeOkfDocument,
  stripLegacyLessonHtmlMeta,
  validateOkfConformance,
  type OkfConformanceIssue,
} from "./okf.js";
import { resolveArchiveContentHash } from "./cursorTranscriptMine.js";
import { createMemoryStore, type MemoryNote } from "./memoryStore.js";

export const LESSON_FIXTURE_NAMES = new Set([
  "lesson.test",
  "lesson.dry",
  "lesson.abc",
  "lesson.chat",
  "lesson.save",
  "lesson.small",
  "lesson.new",
  "lesson.old",
  "lesson.chat-id",
]);

const FIXTURE_NAMES = LESSON_FIXTURE_NAMES;

export interface LessonAuditFlags {
  fixture: boolean;
  metaDistill: boolean;
  stub: boolean;
  missingPlaybook: boolean;
}

export interface LessonAuditRow {
  name: string;
  bytes: number;
  title: string;
  description?: string;
  okf: boolean;
  issues: OkfConformanceIssue[];
  flags: LessonAuditFlags;
  shard: string;
}

export interface LessonCorpusAudit {
  wing: string;
  count: number;
  okfCount: number;
  totalKB: number;
  fixtureCount: number;
  stubCount: number;
  metaDistillCount: number;
  warnIssueCount: number;
  errorIssueCount: number;
  rows: LessonAuditRow[];
}

/** Shard id → OKF bundle subdirectory (Google bundle layout). */
export const LESSON_SHARD_DIRS: Readonly<Record<string, string>> = {
  "A-tparser": "tparser",
  "B-csagent-gateway": "gateway",
  "C-meta-distill": "meta-distill",
  "D-mcp-tooling": "mcp",
  "E-fixture": "_quarantine/fixtures",
  "F-misc": "misc",
};

function shardDir(shard: string): string {
  return LESSON_SHARD_DIRS[shard] ?? "misc";
}

function lessonFileName(name: string): string {
  return `${name.replace(/\./g, "-")}.md`;
}

function playbookSteps(body: string): number {
  const doc = parseOkfDocument(body);
  const text = doc?.body ?? body;
  const pb = text.match(/## (?:Playbook|Steps)\s*\n([\s\S]*?)(?=\n## |\n---|$)/)?.[1] ?? "";
  return pb.split("\n").filter((l) => /^\s*\d+\./.test(l.trim())).length;
}

function classifyShard(body: string, name: string): string {
  const lower = body.toLowerCase();
  if (FIXTURE_NAMES.has(name)) return "E-fixture";
  if (lower.includes("meta-сессия") || lower.includes("meta session") || lower.includes("distill nested")) {
    return "C-meta-distill";
  }
  if (lower.includes("tparser")) return "A-tparser";
  if (lower.includes("gateway") || lower.includes("cron") || lower.includes("csagent")) {
    return "B-csagent-gateway";
  }
  if (lower.includes("mcp")) return "D-mcp-tooling";
  return "F-misc";
}

export function auditLessonNote(note: MemoryNote): LessonAuditRow {
  const body = note.body ?? "";
  const bytes = Buffer.byteLength(body, "utf8");
  const doc = parseOkfDocument(body);
  const text = doc?.body ?? body;
  const steps = playbookSteps(body);
  const flags: LessonAuditFlags = {
    fixture: FIXTURE_NAMES.has(note.name),
    metaDistill:
      text.toLowerCase().includes("meta-сессия") ||
      text.toLowerCase().includes("meta session") ||
      text.toLowerCase().includes("distill nested"),
    stub: bytes < 800 || steps < 2,
    missingPlaybook: steps === 0,
  };
  return {
    name: note.name,
    bytes,
    title: doc?.frontmatter.title ?? note.title,
    description: doc?.frontmatter.description,
    okf: isOkfDocument(body),
    issues: validateOkfConformance(body, note.wing),
    flags,
    shard: classifyShard(body, note.name),
  };
}

export async function auditCursorLessonCorpus(dir: string): Promise<LessonCorpusAudit> {
  loadConfig(dir);
  const memory = createMemoryStore(dir);
  try {
    const notes = await memory.listNotes(CURSOR_LESSON_WING);
    const rows = notes.map(auditLessonNote);
    const totalBytes = rows.reduce((a, r) => a + r.bytes, 0);
    let warnIssueCount = 0;
    let errorIssueCount = 0;
    for (const row of rows) {
      for (const issue of row.issues) {
        if (issue.severity === "warn") warnIssueCount++;
        else errorIssueCount++;
      }
    }
    return {
      wing: CURSOR_LESSON_WING,
      count: rows.length,
      okfCount: rows.filter((r) => r.okf).length,
      totalKB: Math.round(totalBytes / 1024),
      fixtureCount: rows.filter((r) => r.flags.fixture).length,
      stubCount: rows.filter((r) => r.flags.stub).length,
      metaDistillCount: rows.filter((r) => r.flags.metaDistill).length,
      warnIssueCount,
      errorIssueCount,
      rows,
    };
  } finally {
    await memory.close();
  }
}

export interface MigrateLessonsResult {
  scanned: number;
  migrated: number;
  skipped: number;
  errors: string[];
}

export async function migrateCursorLessonsToOkf(
  dir: string,
  opts: { apply?: boolean; limit?: number; names?: string[] } = {}
): Promise<MigrateLessonsResult> {
  loadConfig(dir);
  const memory = createMemoryStore(dir);
  const result: MigrateLessonsResult = { scanned: 0, migrated: 0, skipped: 0, errors: [] };
  try {
    let notes = await memory.listNotes(CURSOR_LESSON_WING);
    if (opts.names?.length) {
      const allow = new Set(opts.names);
      notes = notes.filter((n) => allow.has(n.name));
    }
    if (opts.limit && opts.limit > 0) notes = notes.slice(0, opts.limit);

    for (const note of notes) {
      result.scanned++;
      if (isOkfDocument(note.body) && parseOkfDocument(note.body)?.frontmatter.source) {
        result.skipped++;
        continue;
      }
      try {
        const body = migrateLessonBodyToOkf({
          name: note.name,
          wing: note.wing,
          body: note.body,
          updatedAt: note.updated_at,
        });
        if (opts.apply) {
          if (note.wing !== CURSOR_LESSON_WING) continue;
          saveMemory(dir, note.name, body);
          await memory.upsertNote({ name: note.name, wing: note.wing, body });
        }
        result.migrated++;
      } catch (e) {
        result.errors.push(`${note.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return result;
  } finally {
    await memory.close();
  }
}

export interface LineageRepairCandidate {
  name: string;
  source?: string;
  reason: "missing_sourceHash" | "stale_sourceHash" | "missing_archive";
  archiveHash?: string;
  lessonHash?: string;
}

export interface BackfillLessonLineageResult {
  dryRun: boolean;
  scanned: number;
  updated: number;
  skipped: number;
  candidates: LineageRepairCandidate[];
  errors: string[];
}

/** Patch OKF frontmatter sourceHash and drop stale legacy HTML meta in body. */
export function patchLessonSourceHash(body: string, sourceHash: string): string {
  const doc = parseOkfDocument(body);
  if (!doc) return body;
  return stripLegacyLessonHtmlMeta(
    serializeOkfDocument({ ...doc.frontmatter, sourceHash }, doc.body)
  );
}

export function lessonLineageNeedsBackfill(
  lessonBody: string,
  archiveBody: string | undefined
): LineageRepairCandidate | undefined {
  const lin = parseLessonLineage(lessonBody);
  if (!lin.source || lin.source === "canonical") return undefined;
  if (!lin.source.startsWith("cursor.")) return undefined;
  if (archiveBody === undefined) return undefined;
  const archiveHash = resolveArchiveContentHash(archiveBody);
  if (!archiveHash) {
    return { name: "", source: lin.source, reason: "missing_archive", lessonHash: lin.sourceHash };
  }
  if (!lin.sourceHash) {
    return {
      name: "",
      source: lin.source,
      reason: "missing_sourceHash",
      archiveHash,
      lessonHash: lin.sourceHash,
    };
  }
  if (lin.sourceHash !== archiveHash) {
    return {
      name: "",
      source: lin.source,
      reason: "stale_sourceHash",
      archiveHash,
      lessonHash: lin.sourceHash,
    };
  }
  return undefined;
}

export async function backfillLessonLineage(
  dir: string,
  opts: { apply?: boolean; names?: string[] } = {}
): Promise<BackfillLessonLineageResult> {
  loadConfig(dir);
  const memory = createMemoryStore(dir);
  const result: BackfillLessonLineageResult = {
    dryRun: opts.apply !== true,
    scanned: 0,
    updated: 0,
    skipped: 0,
    candidates: [],
    errors: [],
  };
  try {
    let notes = await memory.listNotes(CURSOR_LESSON_WING);
    if (opts.names?.length) {
      const allow = new Set(opts.names);
      notes = notes.filter((n) => allow.has(n.name));
    }
    for (const note of notes) {
      result.scanned++;
      const lin = parseLessonLineage(note.body ?? "");
      if (!lin.source || lin.source === "canonical" || !lin.source.startsWith("cursor.")) {
        result.skipped++;
        continue;
      }
      const arch = await memory.getNote(lin.source);
      const need = lessonLineageNeedsBackfill(note.body ?? "", arch?.body);
      if (!need) {
        result.skipped++;
        continue;
      }
      result.candidates.push({ ...need, name: note.name });
      if (opts.apply && need.archiveHash) {
        try {
          const body = patchLessonSourceHash(note.body ?? "", need.archiveHash);
          saveMemory(dir, note.name, body);
          await memory.upsertNote({ name: note.name, wing: note.wing, body });
          result.updated++;
        } catch (e) {
          result.errors.push(`${note.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    return result;
  } finally {
    await memory.close();
  }
}

export interface StripLegacyLessonMetaResult {
  dryRun: boolean;
  scanned: number;
  updated: number;
  skipped: number;
  candidates: string[];
  errors: string[];
}

/** Drop legacy HTML lineage comments when OKF YAML frontmatter is present. */
export async function stripLegacyLessonMeta(
  dir: string,
  opts: { apply?: boolean; names?: string[] } = {}
): Promise<StripLegacyLessonMetaResult> {
  loadConfig(dir);
  const memory = createMemoryStore(dir);
  const result: StripLegacyLessonMetaResult = {
    dryRun: opts.apply !== true,
    scanned: 0,
    updated: 0,
    skipped: 0,
    candidates: [],
    errors: [],
  };
  try {
    let notes = await memory.listNotes(CURSOR_LESSON_WING);
    if (opts.names?.length) {
      const allow = new Set(opts.names);
      notes = notes.filter((n) => allow.has(n.name));
    }
    for (const note of notes) {
      result.scanned++;
      const body = note.body ?? "";
      if (!hasLegacyLessonHtmlMeta(body)) {
        result.skipped++;
        continue;
      }
      result.candidates.push(note.name);
      if (opts.apply) {
        try {
          const cleaned = stripLegacyLessonHtmlMeta(body);
          saveMemory(dir, note.name, cleaned);
          await memory.upsertNote({ name: note.name, wing: note.wing, body: cleaned });
          result.updated++;
        } catch (e) {
          result.errors.push(`${note.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    return result;
  } finally {
    await memory.close();
  }
}

const BAD_LESSON_TITLE_RE =
  /^(lesson\.[0-9a-f-]{8,}|Cursor agent[\u2026.]{0,3}|Cursor [0-9a-f-]{8})/i;

export interface RepairLessonTitlesResult {
  dryRun: boolean;
  scanned: number;
  updated: number;
  skipped: number;
  candidates: Array<{ name: string; oldTitle: string; newTitle: string }>;
  errors: string[];
}

function cleanLessonTitle(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/^#+\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

/** Infer human-readable title when frontmatter title is a uuid placeholder. */
export function inferLessonDisplayTitle(body: string, name: string): string | undefined {
  const doc = parseOkfDocument(body);
  if (!doc) return undefined;
  const current = doc.frontmatter.title?.trim() || name;
  if (current !== name && !BAD_LESSON_TITLE_RE.test(current)) return undefined;

  const desc = doc.frontmatter.description?.trim();
  if (desc && desc.length >= 12) {
    const t = cleanLessonTitle(desc);
    if (t.length >= 12 && !BAD_LESSON_TITLE_RE.test(t)) return t;
  }

  const summary = body.match(/## Summary\s*\n([\s\S]*?)(?=\n## |\n---|$)/)?.[1];
  const bullet = summary
    ?.split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("-"));
  if (bullet) {
    const t = cleanLessonTitle(bullet.replace(/^\s*-\s+/, ""));
    if (t.length >= 12 && !BAD_LESSON_TITLE_RE.test(t)) return t;
  }
  return undefined;
}

export function patchLessonTitle(body: string, title: string): string {
  const doc = parseOkfDocument(body);
  if (!doc) return body;
  return serializeOkfDocument({ ...doc.frontmatter, title }, doc.body);
}

export async function repairLessonTitles(
  dir: string,
  opts: { apply?: boolean; names?: string[] } = {}
): Promise<RepairLessonTitlesResult> {
  loadConfig(dir);
  const memory = createMemoryStore(dir);
  const result: RepairLessonTitlesResult = {
    dryRun: opts.apply !== true,
    scanned: 0,
    updated: 0,
    skipped: 0,
    candidates: [],
    errors: [],
  };
  try {
    let notes = await memory.listNotes(CURSOR_LESSON_WING);
    if (opts.names?.length) {
      const allow = new Set(opts.names);
      notes = notes.filter((n) => allow.has(n.name));
    }
    for (const note of notes) {
      result.scanned++;
      const doc = parseOkfDocument(note.body ?? "");
      const oldTitle = doc?.frontmatter.title?.trim() || note.name;
      const newTitle = inferLessonDisplayTitle(note.body ?? "", note.name);
      if (!newTitle || newTitle === oldTitle) {
        result.skipped++;
        continue;
      }
      result.candidates.push({ name: note.name, oldTitle, newTitle });
      if (opts.apply) {
        try {
          const body = patchLessonTitle(note.body ?? "", newTitle);
          saveMemory(dir, note.name, body);
          await memory.upsertNote({ name: note.name, wing: note.wing, body });
          result.updated++;
        } catch (e) {
          result.errors.push(`${note.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    return result;
  } finally {
    await memory.close();
  }
}

export interface ReviewExportResult {
  outDir: string;
  indexPath: string;
  shardPaths: string[];
}

/** Export lesson index + shards for parallel subagent review. */
export function exportLessonReviewBundle(
  audit: LessonCorpusAudit,
  outDir: string
): ReviewExportResult {
  mkdirSync(outDir, { recursive: true });
  const byShard = new Map<string, LessonAuditRow[]>();
  for (const row of audit.rows) {
    const list = byShard.get(row.shard) ?? [];
    list.push(row);
    byShard.set(row.shard, list);
  }

  const shardPaths: string[] = [];
  for (const [shard, rows] of [...byShard.entries()].sort()) {
    const path = join(outDir, `${shard}.json`);
    writeFileSync(path, JSON.stringify(rows, null, 2), "utf8");
    shardPaths.push(path);
  }

  const index = {
    generatedAt: new Date().toISOString(),
    okfVersion: "0.1",
    summary: {
      count: audit.count,
      okfCount: audit.okfCount,
      totalKB: audit.totalKB,
      fixtureCount: audit.fixtureCount,
      stubCount: audit.stubCount,
      metaDistillCount: audit.metaDistillCount,
      shards: [...byShard.entries()].map(([id, rows]) => ({ id, count: rows.length })),
    },
    rubric: {
      retrieval: "1-5: would this help an agent on a similar task?",
      novelty: "1-5: non-duplicative vs siblings and default-wing notes?",
      actionability: "1-5: executable Playbook/Steps?",
      verdict: "keep | merge | quarantine | delete",
    },
  };
  const indexPath = join(outDir, "index.json");
  writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
  return { outDir, indexPath, shardPaths };
}

export interface OkfBundleExportResult {
  outDir: string;
  indexPath: string;
  conceptCount: number;
  shardIndexPaths: string[];
  /** Markdown files removed because they are absent from the current corpus. */
  orphansRemoved: number;
}

/** Drop stale lesson *.md and empty shard dirs after a bundle re-export. */
export function pruneOrphanBundleMarkdown(
  outDir: string,
  keepRelativePaths: ReadonlySet<string>
): number {
  if (!existsSync(outDir)) return 0;

  const orphans: string[] = [];
  function collect(absDir: string, relPrefix: string): void {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) {
        collect(abs, rel);
      } else if (entry.isFile() && entry.name.endsWith(".md") && !keepRelativePaths.has(rel)) {
        orphans.push(abs);
      }
    }
  }
  collect(outDir, "");

  for (const abs of orphans) unlinkSync(abs);

  const emptyDirs: string[] = [];
  function collectEmpty(absDir: string): void {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (entry.isDirectory()) collectEmpty(join(absDir, entry.name));
    }
    if (absDir !== outDir && readdirSync(absDir).length === 0) emptyDirs.push(absDir);
  }
  collectEmpty(outDir);
  emptyDirs.sort((a, b) => b.length - a.length);
  for (const abs of emptyDirs) rmdirSync(abs);

  return orphans.length;
}

function renderShardIndex(rows: LessonAuditRow[], heading: string): string {
  const lines = [`# ${heading}`, ""];
  const sorted = [...rows].sort((a, b) => a.title.localeCompare(b.title));
  for (const row of sorted) {
    const rel = `./${lessonFileName(row.name)}`;
    const desc = row.description?.trim() || row.title;
    lines.push(`* [${row.title}](${rel}) - ${desc}`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Export cursor-lesson wing as an OKF bundle (markdown files + index.md per SPEC §6). */
export async function exportOkfLessonBundle(
  dir: string,
  outDir: string,
  opts: { excludeFixtures?: boolean } = {}
): Promise<OkfBundleExportResult> {
  loadConfig(dir);
  const audit = await auditCursorLessonCorpus(dir);
  const memory = createMemoryStore(dir);
  const shardIndexPaths: string[] = [];
  const keepRelativePaths = new Set<string>(["index.md"]);
  let conceptCount = 0;

  try {
    const notes = await memory.listNotes(CURSOR_LESSON_WING);
    const bodyByName = new Map(notes.map((n) => [n.name, n.body ?? ""]));

    const byShard = new Map<string, LessonAuditRow[]>();
    for (const row of audit.rows) {
      if (opts.excludeFixtures && row.flags.fixture) continue;
      const list = byShard.get(row.shard) ?? [];
      list.push(row);
      byShard.set(row.shard, list);
    }

    for (const [shard, rows] of [...byShard.entries()].sort()) {
      const relShard = shardDir(shard);
      const absShard = join(outDir, relShard);
      mkdirSync(absShard, { recursive: true });
      keepRelativePaths.add(`${relShard}/index.md`);
      for (const row of rows) {
        const relFile = `${relShard}/${lessonFileName(row.name)}`;
        keepRelativePaths.add(relFile);
        writeFileSync(join(outDir, relFile), bodyByName.get(row.name) ?? "", "utf8");
        conceptCount++;
      }
      const shardIndex = join(absShard, "index.md");
      writeFileSync(shardIndex, renderShardIndex(rows, relShard), "utf8");
      shardIndexPaths.push(shardIndex);
    }

    const rootLines = ["# cursor-lesson OKF bundle", "", "# Shards", ""];
    for (const [shard, rows] of [...byShard.entries()].sort()) {
      const relShard = shardDir(shard);
      rootLines.push(
        `* [${relShard}](${relShard}/index.md) - ${rows.length} playbook(s)`
      );
    }
    rootLines.push("");
    const indexPath = join(outDir, "index.md");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(indexPath, rootLines.join("\n"), "utf8");

    const orphansRemoved = pruneOrphanBundleMarkdown(outDir, keepRelativePaths);

    return { outDir, indexPath, conceptCount, shardIndexPaths, orphansRemoved };
  } finally {
    await memory.close();
  }
}

export interface PurgeLessonHygieneOptions {
  apply?: boolean;
  fixtures?: boolean;
  stubs?: boolean;
}

export interface PurgeLessonHygieneResult {
  dryRun: boolean;
  candidates: Array<{ name: string; reason: string; shard: string }>;
  deleted: number;
}

/** Phase-1 hygiene: remove test fixtures and stub lessons (<800 B or <2 steps). */
export async function purgeLessonHygiene(
  dir: string,
  opts: PurgeLessonHygieneOptions = {}
): Promise<PurgeLessonHygieneResult> {
  const includeFixtures = opts.fixtures !== false;
  const includeStubs = opts.stubs !== false;
  const audit = await auditCursorLessonCorpus(dir);
  const candidates: PurgeLessonHygieneResult["candidates"] = [];

  for (const row of audit.rows) {
    const reasons: string[] = [];
    if (includeFixtures && row.flags.fixture) reasons.push("fixture");
    if (includeStubs && row.flags.stub) reasons.push("stub");
    if (!reasons.length) continue;
    candidates.push({
      name: row.name,
      reason: reasons.join("+"),
      shard: row.shard,
    });
  }

  if (!opts.apply) {
    return { dryRun: true, candidates, deleted: 0 };
  }

  loadConfig(dir);
  const memory = createMemoryStore(dir);
  let deleted = 0;
  try {
    for (const c of candidates) {
      if (await memory.deleteNote(c.name)) deleted++;
    }
  } finally {
    await memory.close();
  }
  return { dryRun: false, candidates, deleted };
}

export interface MetaDistillKeepFile {
  version?: number;
  note?: string;
  keep: string[];
}

/** Review-selected distill-workflow exemplars (sync with deploy/meta-distill-keep.json). */
export const META_DISTILL_EXEMPLAR_KEEP: readonly string[] = [
  "lesson.664d5809-69ce-4448-a7b9-0f7725d734d8",
  "lesson.0063cd3b-daaf-4a40-93b2-af5c5c76cd45",
  "lesson.3a5e24e5-0a96-45e0-9248-4b68820ba15c",
  "lesson.7998ba64-dd00-4772-9f9f-1b6a8b83d1a5",
  "lesson.459003aa-fecd-4a33-8e2c-4ff6dd9c2de3",
  "lesson.74523535-1b25-4451-ae11-3c4354ec85d4",
  "lesson.cf3479a9-03d5-4da9-801c-72ee12aeeb6f",
  "lesson.2a44f677-89fc-423f-890a-cdfb2c8e4f03",
  "lesson.bb37d70f-a8ab-4bce-93f2-d10841569e4d",
  "lesson.e9e30481-1f67-4f4d-8308-3eb81b1e9c5d",
  "lesson.89af2543-207d-4203-8110-6159767a5de9",
  "lesson.13bd9611-b426-4834-bf2a-7165f85cf067",
  "lesson.87df2c7c-d444-4e92-a4e9-746bb93f7508",
  "lesson.a82ed4c2-1af8-4957-b404-25a2737124f7",
];

function defaultMetaDistillKeepPath(configDir: string): string {
  const local = join(configDir, ".agent/meta-distill-keep.json");
  if (existsSync(local)) return local;
  const deploy = join(configDir, "deploy/meta-distill-keep.json");
  if (existsSync(deploy)) return deploy;
  return join(dirname(fileURLToPath(import.meta.url)), "../deploy/meta-distill-keep.json");
}

export function loadMetaDistillKeepNames(configDir: string, keepFile?: string): string[] {
  const path = keepFile ?? defaultMetaDistillKeepPath(configDir);
  if (!existsSync(path)) return [...META_DISTILL_EXEMPLAR_KEEP];
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as MetaDistillKeepFile;
  if (!Array.isArray(parsed.keep) || !parsed.keep.every((x) => typeof x === "string")) {
    throw new Error(`${path}: keep must be an array of lesson names`);
  }
  const names = parsed.keep.map((x) => x.trim()).filter(Boolean);
  return names.length ? names : [...META_DISTILL_EXEMPLAR_KEEP];
}

export interface PurgeMetaDistillOptions {
  apply?: boolean;
  keepNames?: string[];
  keepFile?: string;
}

export interface PurgeMetaDistillResult {
  dryRun: boolean;
  keep: string[];
  candidates: Array<{ name: string; shard: string }>;
  deleted: number;
}

/** Phase-2 hygiene: purge meta-distill duplicates; keep exemplar list from review. */
export async function purgeMetaDistill(
  dir: string,
  opts: PurgeMetaDistillOptions = {}
): Promise<PurgeMetaDistillResult> {
  const keep = new Set(opts.keepNames ?? loadMetaDistillKeepNames(dir, opts.keepFile));
  const audit = await auditCursorLessonCorpus(dir);
  const candidates: PurgeMetaDistillResult["candidates"] = [];

  for (const row of audit.rows) {
    if (!row.flags.metaDistill) continue;
    if (keep.has(row.name)) continue;
    candidates.push({ name: row.name, shard: row.shard });
  }

  if (!opts.apply) {
    return { dryRun: true, keep: [...keep], candidates, deleted: 0 };
  }

  const deleted = await deleteLessonCandidates(
    dir,
    candidates.map((c) => c.name),
    true
  );
  return { dryRun: false, keep: [...keep], candidates, deleted };
}

export interface ShardKeepFile {
  version?: number;
  shard?: string;
  note?: string;
  keep: string[];
}

export const DEFAULT_SHARD_KEEP_FILES: Readonly<Record<string, string>> = {
  "A-tparser": "deploy/tparser-keep.json",
  "B-csagent-gateway": "deploy/gateway-keep.json",
  "C-meta-distill": "deploy/meta-distill-keep.json",
};

function resolveShardKeepPath(configDir: string, shard: string, keepFile?: string): string {
  if (keepFile) {
    return keepFile.startsWith("/") ? keepFile : join(configDir, keepFile);
  }
  const rel = DEFAULT_SHARD_KEEP_FILES[shard];
  if (rel) {
    const beside = join(configDir, rel);
    if (existsSync(beside)) return beside;
  }
  const repoRel = DEFAULT_SHARD_KEEP_FILES[shard] ?? join(".agent", `${shard}-keep.json`);
  return join(dirname(fileURLToPath(import.meta.url)), "..", repoRel);
}

export function loadShardKeepNames(
  configDir: string,
  shard: string,
  keepFile?: string
): string[] {
  const path = resolveShardKeepPath(configDir, shard, keepFile);
  if (!existsSync(path)) {
    throw new Error(`keep file not found for shard ${shard}: ${path}`);
  }
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as ShardKeepFile;
  if (!Array.isArray(parsed.keep) || !parsed.keep.every((x) => typeof x === "string")) {
    throw new Error(`${path}: keep must be an array of lesson names`);
  }
  const names = parsed.keep.map((x) => x.trim()).filter(Boolean);
  if (!names.length) throw new Error(`${path}: keep list is empty`);
  return names;
}

export interface PurgeShardOptions {
  shard: string;
  apply?: boolean;
  keepNames?: string[];
  keepFile?: string;
}

export interface PurgeShardResult {
  dryRun: boolean;
  shard: string;
  keep: string[];
  candidates: Array<{ name: string; shard: string }>;
  deleted: number;
}

async function deleteLessonCandidates(
  dir: string,
  names: string[],
  apply: boolean
): Promise<number> {
  if (!apply) return 0;
  loadConfig(dir);
  const memory = createMemoryStore(dir);
  let deleted = 0;
  try {
    for (const name of names) {
      if (await memory.deleteNote(name)) deleted++;
    }
  } finally {
    await memory.close();
  }
  return deleted;
}

/** Phase-2 hygiene: purge shard duplicates; keep names from review JSON. */
export async function purgeLessonShard(
  dir: string,
  opts: PurgeShardOptions
): Promise<PurgeShardResult> {
  const shard = opts.shard.trim();
  if (!shard) throw new Error("shard is required");
  const keep = new Set(opts.keepNames ?? loadShardKeepNames(dir, shard, opts.keepFile));
  const audit = await auditCursorLessonCorpus(dir);
  const candidates: PurgeShardResult["candidates"] = [];

  for (const row of audit.rows) {
    if (row.shard !== shard) continue;
    if (keep.has(row.name)) continue;
    candidates.push({ name: row.name, shard: row.shard });
  }

  const deleted = await deleteLessonCandidates(
    dir,
    candidates.map((c) => c.name),
    opts.apply === true
  );
  return {
    dryRun: opts.apply !== true,
    shard,
    keep: [...keep],
    candidates,
    deleted,
  };
}

export interface PromoteLessonsFile {
  version?: number;
  note?: string;
  promote: string[];
}

function defaultPromoteLessonsPath(configDir: string): string {
  const local = join(configDir, "deploy/promote-lessons.json");
  if (existsSync(local)) return local;
  return join(dirname(fileURLToPath(import.meta.url)), "../deploy/promote-lessons.json");
}

export function loadPromoteLessonNames(configDir: string, promoteFile?: string): string[] {
  const path = promoteFile
    ? promoteFile.startsWith("/")
      ? promoteFile
      : join(configDir, promoteFile)
    : defaultPromoteLessonsPath(configDir);
  if (!existsSync(path)) {
    throw new Error(`promote file not found: ${path}`);
  }
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as PromoteLessonsFile;
  if (!Array.isArray(parsed.promote) || !parsed.promote.every((x) => typeof x === "string")) {
    throw new Error(`${path}: promote must be an array of lesson names`);
  }
  const names = parsed.promote.map((x) => x.trim()).filter(Boolean);
  if (!names.length) throw new Error(`${path}: promote list is empty`);
  return names;
}

export interface PromoteCursorLessonsResult {
  dryRun: boolean;
  scanned: number;
  updated: number;
  skipped: number;
  candidates: Array<{ name: string; oldStatus?: string }>;
  errors: string[];
}

/** Set OKF frontmatter status to approved (HITL promote after reality review). */
export async function promoteCursorLessons(
  dir: string,
  opts: { apply?: boolean; names?: string[]; promoteFile?: string; status?: string } = {}
): Promise<PromoteCursorLessonsResult> {
  loadConfig(dir);
  const targetStatus = opts.status?.trim() || "approved";
  const names = opts.names?.length
    ? opts.names
    : loadPromoteLessonNames(dir, opts.promoteFile);
  const memory = createMemoryStore(dir);
  const result: PromoteCursorLessonsResult = {
    dryRun: opts.apply !== true,
    scanned: 0,
    updated: 0,
    skipped: 0,
    candidates: [],
    errors: [],
  };
  try {
    for (const name of names) {
      result.scanned++;
      const note = await memory.getNote(name);
      if (!note) {
        result.errors.push(`${name}: note not found`);
        continue;
      }
      if (note.wing !== CURSOR_LESSON_WING) {
        result.errors.push(`${name}: wing ${note.wing} is not cursor-lesson`);
        continue;
      }
      const doc = parseOkfDocument(note.body ?? "");
      if (!doc) {
        result.errors.push(`${name}: missing OKF frontmatter`);
        continue;
      }
      const current = doc.frontmatter.status?.trim();
      if (current === targetStatus) {
        result.skipped++;
        continue;
      }
      result.candidates.push({ name, oldStatus: current });
      if (opts.apply) {
        try {
          const body = patchLessonStatus(note.body ?? "", targetStatus);
          saveMemory(dir, name, body);
          await memory.upsertNote({ name, wing: note.wing, body });
          result.updated++;
        } catch (e) {
          result.errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    return result;
  } finally {
    await memory.close();
  }
}
