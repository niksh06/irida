/**
 * `csagent memory` — notes + temporal facts (csagent-memory, issue 036+).
 */
import { isAbsolute, resolve } from "node:path";
import { stdin as input } from "node:process";
import { loadConfig, ConfigError } from "./config.js";
import { importHappyinKb } from "./importHappyinKb.js";
import { MemoryError, deleteMemory, listMemories, readMemory, saveMemory } from "./memory.js";
import { alignMemorySilos } from "./memorySiloOps.js";
import { createMemoryStore, SECURE_WING } from "./memoryStore.js";
import { CURSOR_TRANSCRIPT_WING } from "./memoryWings.js";
import { ingestRecentSessions } from "./sessionIngest.js";
import { mineCursorTranscripts } from "./cursorTranscriptMine.js";
import {
  buildCursorDistillQueue,
  formatDistillQueueJson,
  formatDistillQueueMarkdown,
  loadCursorDistillBaseline,
  saveCursorDistillBaseline,
} from "./cursorTranscriptDistill.js";
import { runCursorDistillBatch } from "./cursorTranscriptDistillOrchestrator.js";
import {
  auditCursorLessonCorpus,
  backfillLessonLineage,
  exportLessonReviewBundle,
  exportOkfLessonBundle,
  migrateCursorLessonsToOkf,
  promoteCursorLessons,
  purgeLessonHygiene,
  purgeLessonShard,
  purgeMetaDistill,
  repairLessonTitles,
  stripLegacyLessonMeta,
} from "./memoryOkf.js";
import {
  evaluateMemoryAudit,
  formatMemoryAuditReport,
  saveMemoryAuditResult,
  DEFAULT_STALE_DAYS,
} from "./memoryAudit.js";
import { parseOlderThanDays, pruneSeenPostFacts, purgeAllSeenPostFacts, purgeMalformedSubjectFacts, SEEN_POST_TTL_DAYS } from "./memoryFactPrune.js";
import { MemoryFactValidationError } from "./memoryFactValidate.js";
import { buildMemorySearchOptions } from "./memorySearchPolicy.js";
import { runDefaultCorpusReWing } from "./memoryReWing.js";
import { purgeArchiveNotes, DEFAULT_ARCHIVE_RETENTION_DAYS } from "./memoryArchivePurge.js";
import {
  buildLessonEvalRows,
  parseLessonEvalVerdict,
  recordLessonEval,
  resolveLessonEvalOutPath,
  summarizeLessonEval,
  validateLessonEvalScaffold,
  writeLessonEvalSheet,
} from "./cursorLessonEval.js";

const SEARCH_FLAG_RE = /^--(?:include-archive|include-episodic|semantic|hybrid)$/;

/** Parse `--wing default` / `--wing=a,b` from memory search argv. */
export function parseMemorySearchWingFlags(args: string[]): { wings: string[]; rest: string[] } {
  const wings: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--wing" || a === "--wings") {
      const v = args[++i];
      if (v) wings.push(...v.split(",").map((s) => s.trim()).filter(Boolean));
      continue;
    }
    if (a.startsWith("--wing=")) {
      wings.push(...a.slice("--wing=".length).split(",").map((s) => s.trim()).filter(Boolean));
      continue;
    }
    rest.push(a);
  }
  return { wings, rest };
}
import { EXIT, type ExitCode } from "./exit.js";
import { recordMemoryDelete } from "./actionTranscript.js";

export interface MemoryCmdOptions {
  dir?: string;
}

/** Pull `--dir PATH` from argv so all memory subcommands honor prod config roots. */
function consumeDirFlag(argv: string[], opts: MemoryCmdOptions): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir" && argv[i + 1]) {
      opts.dir = argv[++i];
    } else {
      out.push(a!);
    }
  }
  return out;
}

async function readStdinAll(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    input.setEncoding("utf8");
    input.on("data", (c) => {
      data += c;
    });
    input.on("end", () => resolve(data));
    input.on("error", reject);
    if (input.isPaused()) input.resume();
  });
}

async function withStore<T>(dir: string, fn: (store: ReturnType<typeof createMemoryStore>) => Promise<T>): Promise<T> {
  const cfg = loadConfig(dir);
  const store = createMemoryStore(dir, cfg.stateDir);
  try {
    return await fn(store);
  } finally {
    await store.close();
  }
}

/** Mirror note to .md so sync @memory: injection keeps working. */
function mirrorNoteFile(dir: string, name: string, body: string): void {
  saveMemory(dir, name, body);
}

export async function cmdMemoryList(opts: MemoryCmdOptions = {}): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  try {
    loadConfig(dir);
    const notes = await withStore(dir, (s) => s.listNotes());
    if (notes.length === 0) {
      const files = listMemories(dir);
      if (files.length === 0) {
        console.log("No memories — use: csagent memory add <name>");
        return EXIT.ok;
      }
      console.log("NAME             WING       TITLE                                    PREVIEW");
      for (const m of files) {
        console.log(
          `${m.name.padEnd(16)} ${"file".padEnd(10)} ${m.title.slice(0, 40).padEnd(40)} ${m.preview.slice(0, 48)}`
        );
      }
      return EXIT.ok;
    }
    console.log("NAME             WING       TITLE                                    PREVIEW");
    for (const m of notes) {
      const preview = m.body.replace(/\s+/g, " ").trim().slice(0, 48);
      console.log(
        `${m.name.padEnd(16)} ${m.wing.slice(0, 10).padEnd(10)} ${m.title.slice(0, 40).padEnd(40)} ${preview}`
      );
    }
    return EXIT.ok;
  } catch (e) {
    console.error("memory: " + (e instanceof ConfigError || e instanceof MemoryError ? e.message : String(e)));
    return EXIT.config;
  }
}

export async function cmdMemoryShow(name: string, opts: MemoryCmdOptions = {}): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  if (!name.trim()) {
    console.error("memory show: name required");
    return EXIT.usage;
  }
  try {
    const note = await withStore(dir, (s) => s.getNote(name));
    if (note) {
      console.log(note.body);
      return EXIT.ok;
    }
    console.log(readMemory(dir, name));
    return EXIT.ok;
  } catch (e) {
    console.error("memory: " + (e instanceof MemoryError ? e.message : String(e)));
    return EXIT.usage;
  }
}

export async function cmdMemoryAdd(
  name: string,
  bodyArg: string | undefined,
  opts: MemoryCmdOptions & { stdin?: boolean; wing?: string } = {}
): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  if (!name.trim()) {
    console.error("memory add: name required, e.g. csagent memory add project --stdin");
    return EXIT.usage;
  }
  let body = bodyArg?.trim() ?? "";
  if (opts.stdin || (!body && !input.isTTY)) {
    body = (await readStdinAll()).trim();
  }
  if (!body) {
    console.error("memory add: provide body text or use --stdin");
    return EXIT.usage;
  }
  try {
    if (opts.wing?.trim() === SECURE_WING) {
      // Never mirror secure notes to plaintext .md files.
      await withStore(dir, (s) => s.upsertNote({ name, body, wing: opts.wing }));
      console.log(`memory: saved ${name} (encrypted, store only — read via memory show)`);
      return EXIT.ok;
    }
    // File mirror first: @memory refs and previews read files, so on partial
    // failure the read path must see the newer content, not a stale mirror.
    mirrorNoteFile(dir, name, body);
    await withStore(dir, (s) => s.upsertNote({ name, body, wing: opts.wing }));
    console.log(`memory: saved ${name} (store + .agent/memory/${name.replace(/\.md$/i, "")}.md)`);
    return EXIT.ok;
  } catch (e) {
    console.error("memory: " + (e instanceof MemoryError ? e.message : String(e)));
    return EXIT.usage;
  }
}

export async function cmdMemoryRm(name: string, opts: MemoryCmdOptions = {}): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  if (!name.trim()) {
    console.error("memory rm: name required");
    return EXIT.usage;
  }
  try {
    const note = await withStore(dir, (s) => s.getNote(name));
    const removed = await withStore(dir, (s) => s.deleteNote(name));
    const fileRemoved = deleteMemory(dir, name);
    if (removed && note) {
      recordMemoryDelete(dir, {
        name: note.name,
        wing: note.wing,
        body: note.body,
        title: note.title,
      });
    }
    if (removed || fileRemoved) console.log(`memory: removed ${name}`);
    else console.log(`memory: not found: ${name}`);
    return EXIT.ok;
  } catch (e) {
    console.error("memory: " + (e instanceof MemoryError ? e.message : String(e)));
    return EXIT.usage;
  }
}

export async function cmdMemorySearch(
  query: string,
  opts: MemoryCmdOptions & {
    semantic?: boolean;
    hybrid?: boolean;
    includeArchive?: boolean;
    includeEpisodic?: boolean;
    wings?: string[];
  } = {}
): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  if (!query.trim()) {
    console.error("memory search: query required");
    return EXIT.usage;
  }
  const searchOpts = buildMemorySearchOptions(opts);
  try {
    const hits = await withStore(dir, async (s) => {
      if (opts.hybrid) {
        if (!s.searchNotesHybrid) {
          throw new MemoryError(
            "--hybrid requires Postgres + memory.embeddings.enabled (see REFERENCE.md)"
          );
        }
        const hybrid = await s.searchNotesHybrid(query, undefined, searchOpts);
        if (hybrid.length > 0) return hybrid;
        return s.searchNotes(query, undefined, searchOpts);
      }
      if (opts.semantic) {
        if (!s.searchNotesSemantic) {
          throw new MemoryError(
            "--semantic requires Postgres + memory.embeddings.enabled (see REFERENCE.md)"
          );
        }
        const semantic = await s.searchNotesSemantic(query, undefined, searchOpts);
        if (semantic.length > 0) return semantic;
        // Embedding daemon down or nothing indexed → keyword fallback.
        return s.searchNotes(query, undefined, searchOpts);
      }
      return s.searchNotes(query, undefined, searchOpts);
    });
    if (hits.length === 0) {
      console.log("No matches.");
      return EXIT.ok;
    }
    for (const n of hits) {
      const preview = n.body.replace(/\s+/g, " ").trim().slice(0, 120);
      console.log(`${n.name} [${n.wing}] ${n.title}`);
      console.log(`  ${preview}`);
    }
    return EXIT.ok;
  } catch (e) {
    console.error("memory: " + String(e));
    return EXIT.config;
  }
}

export async function cmdMemoryImportMd(
  argv: string[],
  opts: MemoryCmdOptions = {}
): Promise<ExitCode> {
  let memoryDir = opts.dir ?? process.cwd();
  let kbRoot = process.env.CSAGENT_KB_ROOT?.trim() ?? "";
  let dryRun = false;
  const domains: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--dir" && argv[i + 1]) memoryDir = argv[++i]!;
    else if (a === "--kb-root" && argv[i + 1]) kbRoot = argv[++i]!;
    else if ((a === "--domains" || a === "--domain") && argv[i + 1]) {
      for (const d of argv[++i]!.split(",")) {
        const t = d.trim();
        if (t) domains.push(t);
      }
    }
  }
  if (!kbRoot) {
    console.error("memory import-md: --kb-root PATH required (or set CSAGENT_KB_ROOT)");
    return EXIT.usage;
  }
  try {
    const result = await importHappyinKb({
      kbRoot,
      memoryDir,
      dryRun,
      domains: domains.length ? domains : undefined,
    });
    if (dryRun) {
      console.log(
        `dry-run: ${result.imported} notes, commit=${result.commit}, aliases=${result.aliases}`
      );
      return EXIT.ok;
    }
    console.log(
      `import-md: ${result.imported} notes (commit ${result.commit}, aliases ${result.aliases})`
    );
    return EXIT.ok;
  } catch (e) {
    console.error("memory import-md: " + (e instanceof Error ? e.message : String(e)));
    return EXIT.config;
  }
}

export async function cmdMemoryFact(argv: string[], opts: MemoryCmdOptions = {}): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  const [sub, ...rest] = argv;
  switch (sub) {
    case "add": {
      const subject = rest[0];
      const predicate = rest[1];
      const object = rest.slice(2).join(" ").trim();
      if (!subject || !predicate || !object) {
        console.error("usage: csagent memory fact add <subject> <predicate> <object>");
        return EXIT.usage;
      }
      try {
        const fact = await withStore(dir, (s) => s.addFact({ subject, predicate, object }));
        console.log(`fact: ${fact.id}  ${fact.subject} ${fact.predicate} ${fact.object}`);
        return EXIT.ok;
      } catch (e) {
        if (e instanceof MemoryFactValidationError) {
          console.error("memory fact add: " + e.message);
          return EXIT.usage;
        }
        throw e;
      }
    }
    case "query": {
      const subject = rest[0];
      const predicate = rest[1];
      if (!subject) {
        console.error("usage: csagent memory fact query <subject> [predicate]");
        return EXIT.usage;
      }
      const facts = await withStore(dir, (s) => s.queryFacts({ subject, predicate }));
      if (facts.length === 0) {
        console.log("No current facts.");
        return EXIT.ok;
      }
      for (const f of facts) {
        console.log(`${f.id}  ${f.subject} ${f.predicate} ${f.object}  (since ${f.valid_from ?? "?"})`);
      }
      return EXIT.ok;
    }
    case "invalidate": {
      const id = rest[0];
      if (!id) {
        console.error("usage: csagent memory fact invalidate <fact-id>");
        return EXIT.usage;
      }
      const ok = await withStore(dir, (s) => s.invalidateFact(id));
      console.log(ok ? `fact: invalidated ${id}` : `fact: not found or already ended: ${id}`);
      return EXIT.ok;
    }
    case "purge-seen-post": {
      let dryRun = false;
      for (const a of rest) {
        if (a === "--dry-run") dryRun = true;
      }
      const result = await purgeAllSeenPostFacts(dir, { dryRun });
      console.log(
        `seen_post purge${dryRun ? " (dry-run)" : ""}: matched=${result.matched} invalidated=${result.pruned}`
      );
      return EXIT.ok;
    }
    case "purge-malformed-subjects": {
      let dryRun = false;
      for (const a of rest) {
        if (a === "--dry-run") dryRun = true;
      }
      const result = await purgeMalformedSubjectFacts(dir, { dryRun });
      console.log(
        `malformed-subjects purge${dryRun ? " (dry-run)" : ""}: matched=${result.matched} invalidated=${result.pruned}`
      );
      return EXIT.ok;
    }
    case "prune": {
      const subject = rest[0];
      if (subject !== "seen_post") {
        console.error("usage: csagent memory fact prune seen_post --older-than 30d [--dry-run]");
        return EXIT.usage;
      }
      let olderThan = `${SEEN_POST_TTL_DAYS}d`;
      let dryRun = false;
      for (let i = 1; i < rest.length; i++) {
        const a = rest[i];
        if (a === "--dry-run") dryRun = true;
        else if (a === "--older-than" && rest[i + 1]) olderThan = rest[++i]!;
      }
      const days = parseOlderThanDays(olderThan);
      if (!days) {
        console.error("memory fact prune: --older-than must be like 30d");
        return EXIT.usage;
      }
      const result = await pruneSeenPostFacts(dir, { olderThanDays: days, dryRun });
      console.log(
        `seen_post prune${dryRun ? " (dry-run)" : ""}: matched=${result.matched} pruned=${result.pruned} (>${days}d)`
      );
      return EXIT.ok;
    }
    default:
      console.log(`Usage:
  csagent memory fact add <subject> <predicate> <object>
  csagent memory fact query <subject> [predicate]
  csagent memory fact invalidate <fact-id>
  csagent memory fact purge-seen-post [--dry-run]
  csagent memory fact purge-malformed-subjects [--dry-run]
  csagent memory fact prune seen_post --older-than 30d [--dry-run]  (legacy TTL)
`);
      return sub ? EXIT.usage : EXIT.ok;
  }
}

export async function cmdMemoryAudit(argv: string[], opts: MemoryCmdOptions = {}): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  let staleDays = DEFAULT_STALE_DAYS;
  let checkLinks = false;
  let opsOnly = true;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--links") checkLinks = true;
    else if (a === "--all-notes") opsOnly = false;
    else if (a === "--json") json = true;
    else if (a === "--stale-days" && argv[i + 1]) staleDays = parseInt(argv[++i]!, 10);
  }
  if (!Number.isFinite(staleDays) || staleDays < 1) {
    console.error("memory audit: --stale-days must be a positive integer");
    return EXIT.usage;
  }
  try {
    loadConfig(dir);
    const report = await evaluateMemoryAudit({ dir, staleDays, checkLinks, opsOnly });
    saveMemoryAuditResult(dir, report);
    if (json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatMemoryAuditReport(report));
    }
    return report.ok ? EXIT.ok : EXIT.software;
  } catch (e) {
    console.error("memory audit: " + (e instanceof ConfigError ? e.message : String(e)));
    return EXIT.config;
  }
}

export async function cmdMemoryAlignSilo(
  argv: string[],
  opts: MemoryCmdOptions = {}
): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  const dryRun = argv.includes("--dry-run");
  try {
    loadConfig(dir);
    const result = alignMemorySilos(dir, dryRun);
    const mode = dryRun ? " (dry-run)" : "";
    console.log(
      `memory align-silo${mode}: copied=${result.copied} symlinked=${result.symlinked.length} skipped=${result.skipped.length}`
    );
    if (result.symlinked.length) {
      for (const p of result.symlinked) console.log(`  silo: ${p}`);
    }
    return EXIT.ok;
  } catch (e) {
    console.error("memory align-silo: " + (e instanceof ConfigError ? e.message : String(e)));
    return EXIT.config;
  }
}

export async function cmdMemoryReindexEmbeddings(opts: MemoryCmdOptions = {}): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  try {
    const updated = await withStore(dir, async (s) => {
      if (!s.reindexEmbeddings) {
        throw new MemoryError(
          "reindex-embeddings requires Postgres + memory.embeddings.enabled (see REFERENCE.md)"
        );
      }
      return s.reindexEmbeddings();
    });
    console.log(`memory: embedded ${updated} note(s)`);
    return EXIT.ok;
  } catch (e) {
    console.error("memory: " + (e instanceof MemoryError ? e.message : String(e)));
    return EXIT.usage;
  }
}

export async function cmdMemoryIngestSessions(
  argv: string[],
  opts: MemoryCmdOptions = {}
): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  let windowHours = 168;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") force = true;
    else if (a === "--window-hours" && argv[i + 1]) {
      windowHours = Number(argv[++i]);
    }
  }
  if (!Number.isFinite(windowHours) || windowHours < 1) {
    console.error("memory ingest-sessions: --window-hours must be a positive number");
    return EXIT.usage;
  }
  try {
    loadConfig(dir);
    const out = await ingestRecentSessions(dir, { windowHours, force });
    const total = out.ingested + out.updated;
    console.log(
      `session-ingest: ${total} note(s) (${out.ingested} new, ${out.updated} updated, ${out.skipped} skipped)`
    );
    for (const name of out.names) console.log(`  ${name}`);
    return EXIT.ok;
  } catch (e) {
    console.error("memory ingest-sessions: " + (e instanceof ConfigError ? e.message : String(e)));
    return EXIT.config;
  }
}

export async function cmdMemoryMineCursor(
  argv: string[],
  opts: MemoryCmdOptions = {}
): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  let windowHours = 168;
  let limit = 30;
  let force = false;
  let scanAll = false;
  let includeSubagents = false;
  let projectsRoot: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") force = true;
    else if (a === "--all") scanAll = true;
    else if (a === "--include-subagents") includeSubagents = true;
    else if (a === "--window-hours" && argv[i + 1]) windowHours = Number(argv[++i]);
    else if (a === "--limit" && argv[i + 1]) limit = Number(argv[++i]);
    else if (a === "--projects-root" && argv[i + 1]) projectsRoot = argv[++i];
  }
  if (!scanAll && (!Number.isFinite(windowHours) || windowHours < 1)) {
    console.error("memory mine-cursor: --window-hours must be a positive number");
    return EXIT.usage;
  }
  if (!scanAll && (!Number.isFinite(limit) || limit < 1)) {
    console.error("memory mine-cursor: --limit must be a positive number");
    return EXIT.usage;
  }
  try {
    loadConfig(dir);
    const out = await mineCursorTranscripts(dir, {
      all: scanAll,
      windowHours,
      limit,
      force,
      includeSubagents,
      projectsRoot,
    });
    const total = out.ingested + out.updated;
    console.log(
      `cursor-mine: ${total} note(s) (${out.ingested} new, ${out.updated} updated, ${out.skipped} skipped)`
    );
    for (const name of out.names) console.log(`  ${name}`);
    return EXIT.ok;
  } catch (e) {
    console.error("memory mine-cursor: " + (e instanceof ConfigError ? e.message : String(e)));
    return EXIT.config;
  }
}

export async function cmdMemoryDistillCursor(
  argv: string[],
  opts: MemoryCmdOptions = {}
): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  let limit = 10;
  let force = false;
  let json = false;
  let minBodyBytes = 0;
  let backfill = false;
  let setBaseline = false;
  let baselineNote: string | undefined;
  let runBatch = false;
  let dryRun = false;
  let parallel = 3;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") force = true;
    else if (a === "--json") json = true;
    else if (a === "--backfill") backfill = true;
    else if (a === "--run") runBatch = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--set-baseline") setBaseline = true;
    else if (a === "--baseline-note" && argv[i + 1]) baselineNote = argv[++i];
    else if (a === "--limit" && argv[i + 1]) limit = Number(argv[++i]);
    else if (a === "--min-bytes" && argv[i + 1]) minBodyBytes = Number(argv[++i]);
    else if (a === "--parallel" && argv[i + 1]) parallel = Number(argv[++i]);
  }
  if (setBaseline) {
    try {
      loadConfig(dir);
      const pending = await buildCursorDistillQueue(dir, {
        limit: 100_000,
        backfill: true,
      });
      if (pending.candidates.length > 0) {
        console.error(
          "memory distill-cursor: backfill queue not empty — finish backfill before --set-baseline"
        );
        return EXIT.usage;
      }
      const record = saveCursorDistillBaseline(dir, new Date().toISOString(), baselineNote);
      console.log(`cursor-distill baseline: ${record.baselineAt}`);
      if (record.note) console.log(`note: ${record.note}`);
      return EXIT.ok;
    } catch (e) {
      console.error("memory distill-cursor: " + (e instanceof ConfigError ? e.message : String(e)));
      return EXIT.config;
    }
  }
  const existingBaseline = loadCursorDistillBaseline(dir);
  if (argv.includes("--show-baseline")) {
    if (!existingBaseline) {
      console.log("cursor-distill baseline: not set (delta mode queues all stale/missing)");
      return EXIT.ok;
    }
    console.log(`cursor-distill baseline: ${existingBaseline.baselineAt}`);
    if (existingBaseline.note) console.log(`note: ${existingBaseline.note}`);
    return EXIT.ok;
  }
  if (!Number.isFinite(limit) || limit < 1) {
    console.error("memory distill-cursor: --limit must be a positive number");
    return EXIT.usage;
  }
  if (!Number.isFinite(minBodyBytes) || minBodyBytes < 0) {
    console.error("memory distill-cursor: --min-bytes must be a non-negative number");
    return EXIT.usage;
  }
  if (!Number.isFinite(parallel) || parallel < 1) {
    console.error("memory distill-cursor: --parallel must be a positive number");
    return EXIT.usage;
  }
  try {
    if (runBatch) {
      const batch = await runCursorDistillBatch({
        dir,
        limit,
        parallel,
        force,
        minBodyBytes,
        backfill,
        dryRun,
      });
      for (const r of batch.results) {
        const status = r.ok ? "ok" : "fail";
        console.log(`${status}\t${r.sourceName}\t${r.chunks} chunk(s)\t${r.message}`);
      }
      console.log(
        `cursor-distill --run: ${batch.saved} saved, ${batch.failed} failed, ${batch.processed} processed` +
          (dryRun ? " (dry-run)" : "")
      );
      return batch.failed > 0 ? EXIT.software : EXIT.ok;
    }
    const out = await buildCursorDistillQueue(dir, { limit, force, minBodyBytes, backfill });
    console.log(json ? formatDistillQueueJson(out) : formatDistillQueueMarkdown(out));
    return EXIT.ok;
  } catch (e) {
    console.error("memory distill-cursor: " + (e instanceof ConfigError ? e.message : String(e)));
    return EXIT.config;
  }
}

export async function cmdMemoryOkf(argv: string[], opts: MemoryCmdOptions = {}): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  const [action, ...rest] = argv;
  let apply = false;
  let json = false;
  let limit = 0;
  let outDir = "Reports/cursor-lesson-review";
  let bundleOut = ".agent/memory/okf/cursor-lesson";
  let excludeFixtures = false;
  let purgeFixtures = true;
  let purgeStubs = true;
  let keepFile: string | undefined;
  let shard = "";
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--apply") apply = true;
    else if (a === "--json") json = true;
    else if (a === "--limit" && rest[i + 1]) limit = Number(rest[++i]);
    else if (a === "--out" && rest[i + 1]) outDir = rest[++i]!;
    else if (a === "--bundle-out" && rest[i + 1]) bundleOut = rest[++i]!;
    else if (a === "--exclude-fixtures") excludeFixtures = true;
    else if (a === "--fixtures-only") {
      purgeFixtures = true;
      purgeStubs = false;
    }     else if (a === "--stubs-only") {
      purgeFixtures = false;
      purgeStubs = true;
    } else if (a === "--keep-file" && rest[i + 1]) keepFile = rest[++i]!;
    else if (a === "--shard" && rest[i + 1]) shard = rest[++i]!;
  }
  outDir = isAbsolute(outDir) ? outDir : resolve(dir, outDir);
  bundleOut = isAbsolute(bundleOut) ? bundleOut : resolve(dir, bundleOut);
  try {
    loadConfig(dir);
    switch (action) {
      case "audit": {
        const audit = await auditCursorLessonCorpus(dir);
        if (json) {
          console.log(JSON.stringify(audit, null, 2));
        } else {
          console.log(
            `# cursor-lesson OKF audit\n\nNotes: ${audit.count} · OKF: ${audit.okfCount} · ${audit.totalKB} KB\nFixtures: ${audit.fixtureCount} · stubs: ${audit.stubCount} · meta-distill: ${audit.metaDistillCount}\nIssues: ${audit.errorIssueCount} error · ${audit.warnIssueCount} warn`
          );
          const shards = new Map<string, number>();
          for (const row of audit.rows) shards.set(row.shard, (shards.get(row.shard) ?? 0) + 1);
          for (const [id, n] of [...shards.entries()].sort()) {
            console.log(`  ${id}: ${n}`);
          }
        }
        return EXIT.ok;
      }
      case "migrate-lessons": {
        const result = await migrateCursorLessonsToOkf(dir, {
          apply,
          limit: limit > 0 ? limit : undefined,
        });
        console.log(
          `okf migrate-lessons: scanned=${result.scanned} migrated=${result.migrated} skipped=${result.skipped}${apply ? " (applied)" : " (dry-run)"}`
        );
        for (const err of result.errors) console.error(`  error: ${err}`);
        return result.errors.length ? EXIT.software : EXIT.ok;
      }
      case "backfill-lineage": {
        const result = await backfillLessonLineage(dir, { apply });
        console.log(
          `okf backfill-lineage${result.dryRun ? " (dry-run)" : " (applied)"}: scanned=${result.scanned} candidates=${result.candidates.length} updated=${result.updated} skipped=${result.skipped}`
        );
        for (const c of result.candidates.slice(0, 20)) {
          console.log(`  ${c.name}: ${c.reason}${c.archiveHash ? ` → ${c.archiveHash}` : ""}`);
        }
        if (result.candidates.length > 20) {
          console.log(`  … +${result.candidates.length - 20} more`);
        }
        for (const err of result.errors) console.error(`  error: ${err}`);
        return result.errors.length ? EXIT.software : EXIT.ok;
      }
      case "repair-titles": {
        const result = await repairLessonTitles(dir, { apply });
        console.log(
          `okf repair-titles${result.dryRun ? " (dry-run)" : " (applied)"}: scanned=${result.scanned} candidates=${result.candidates.length} updated=${result.updated} skipped=${result.skipped}`
        );
        for (const c of result.candidates.slice(0, 15)) {
          console.log(`  ${c.name}: "${c.oldTitle.slice(0, 40)}" → "${c.newTitle.slice(0, 60)}"`);
        }
        if (result.candidates.length > 15) {
          console.log(`  … +${result.candidates.length - 15} more`);
        }
        for (const err of result.errors) console.error(`  error: ${err}`);
        return result.errors.length ? EXIT.software : EXIT.ok;
      }
      case "strip-legacy-meta": {
        const result = await stripLegacyLessonMeta(dir, { apply });
        console.log(
          `okf strip-legacy-meta${result.dryRun ? " (dry-run)" : " (applied)"}: scanned=${result.scanned} candidates=${result.candidates.length} updated=${result.updated} skipped=${result.skipped}`
        );
        for (const name of result.candidates.slice(0, 20)) console.log(`  ${name}`);
        if (result.candidates.length > 20) console.log(`  … +${result.candidates.length - 20} more`);
        for (const err of result.errors) console.error(`  error: ${err}`);
        return result.errors.length ? EXIT.software : EXIT.ok;
      }
      case "promote": {
        const result = await promoteCursorLessons(dir, { apply, promoteFile: keepFile || undefined });
        console.log(
          `okf promote${result.dryRun ? " (dry-run)" : " (applied)"}: scanned=${result.scanned} candidates=${result.candidates.length} updated=${result.updated} skipped=${result.skipped}`
        );
        for (const c of result.candidates) {
          console.log(`  ${c.name}: ${c.oldStatus ?? "(none)"} → approved`);
        }
        for (const err of result.errors) console.error(`  error: ${err}`);
        return result.errors.length ? EXIT.software : EXIT.ok;
      }
      case "export-review": {
        const audit = await auditCursorLessonCorpus(dir);
        const exported = exportLessonReviewBundle(audit, outDir);
        console.log(`okf export-review: ${exported.indexPath}`);
        for (const p of exported.shardPaths) console.log(`  ${p}`);
        return EXIT.ok;
      }
      case "export-bundle": {
        const exported = await exportOkfLessonBundle(dir, bundleOut, { excludeFixtures });
        const orphanNote =
          exported.orphansRemoved > 0 ? ` · removed ${exported.orphansRemoved} orphan(s)` : "";
        console.log(
          `okf export-bundle: ${exported.indexPath} (${exported.conceptCount} concept(s)${orphanNote})`
        );
        for (const p of exported.shardIndexPaths) console.log(`  ${p}`);
        return EXIT.ok;
      }
      case "purge-stubs": {
        const result = await purgeLessonHygiene(dir, {
          apply,
          fixtures: purgeFixtures,
          stubs: purgeStubs,
        });
        const mode = result.dryRun ? "dry-run" : "applied";
        console.log(
          `okf purge-stubs (${mode}): ${result.candidates.length} candidate(s)${result.deleted ? ` · deleted=${result.deleted}` : ""}`
        );
        for (const c of result.candidates) {
          console.log(`  ${c.name} [${c.reason}] ${c.shard}`);
        }
        return EXIT.ok;
      }
      case "purge-meta-distill": {
        const result = await purgeMetaDistill(dir, { apply, keepFile });
        const mode = result.dryRun ? "dry-run" : "applied";
        console.log(
          `okf purge-meta-distill (${mode}): keep=${result.keep.length} · purge=${result.candidates.length}${result.deleted ? ` · deleted=${result.deleted}` : ""}`
        );
        for (const name of result.keep) console.log(`  keep ${name}`);
        for (const c of result.candidates) {
          console.log(`  purge ${c.name}`);
        }
        return EXIT.ok;
      }
      case "purge-tparser": {
        const result = await purgeLessonShard(dir, {
          shard: "A-tparser",
          apply,
          keepFile,
        });
        const mode = result.dryRun ? "dry-run" : "applied";
        console.log(
          `okf purge-tparser (${mode}): keep=${result.keep.length} · purge=${result.candidates.length}${result.deleted ? ` · deleted=${result.deleted}` : ""}`
        );
        return EXIT.ok;
      }
      case "purge-gateway": {
        const result = await purgeLessonShard(dir, {
          shard: "B-csagent-gateway",
          apply,
          keepFile,
        });
        const mode = result.dryRun ? "dry-run" : "applied";
        console.log(
          `okf purge-gateway (${mode}): keep=${result.keep.length} · purge=${result.candidates.length}${result.deleted ? ` · deleted=${result.deleted}` : ""}`
        );
        return EXIT.ok;
      }
      case "purge-shard": {
        if (!shard) {
          console.error("memory okf purge-shard: --shard required (e.g. A-tparser)");
          return EXIT.usage;
        }
        const result = await purgeLessonShard(dir, { shard, apply, keepFile });
        const mode = result.dryRun ? "dry-run" : "applied";
        console.log(
          `okf purge-shard (${mode}) ${result.shard}: keep=${result.keep.length} · purge=${result.candidates.length}${result.deleted ? ` · deleted=${result.deleted}` : ""}`
        );
        for (const name of result.keep) console.log(`  keep ${name}`);
        for (const c of result.candidates) console.log(`  purge ${c.name}`);
        return EXIT.ok;
      }
      default:
        console.error(`memory okf: unknown action '${action ?? ""}'`);
        console.error(`Usage:
  csagent memory okf audit [--json]
  csagent memory okf migrate-lessons [--apply] [--limit N]
  csagent memory okf backfill-lineage [--apply]   # sourceHash from cursor-ide archive
  csagent memory okf repair-titles [--apply]      # human title from description/Summary
  csagent memory okf strip-legacy-meta [--apply] # drop HTML lineage when YAML present
  csagent memory okf promote [--apply] [--keep-file deploy/promote-lessons.json]
  csagent memory okf export-review [--out Reports/cursor-lesson-review]
  csagent memory okf export-bundle [--bundle-out .agent/memory/okf/cursor-lesson] [--exclude-fixtures]
  csagent memory okf purge-stubs [--apply] [--fixtures-only | --stubs-only]
  csagent memory okf purge-meta-distill [--apply] [--keep-file deploy/meta-distill-keep.json]
  csagent memory okf purge-tparser [--apply] [--keep-file deploy/tparser-keep.json]
  csagent memory okf purge-gateway [--apply] [--keep-file deploy/gateway-keep.json]
  csagent memory okf purge-shard --shard A-tparser [--apply] [--keep-file …]`);
        return EXIT.usage;
    }
  } catch (e) {
    console.error("memory okf: " + (e instanceof ConfigError ? e.message : String(e)));
    return EXIT.config;
  }
}

export async function cmdMemoryReWing(argv: string[], opts: MemoryCmdOptions = {}): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  const apply = argv.includes("--apply");
  try {
    const result = await withStore(dir, (store) => runDefaultCorpusReWing(store, { apply }));
    const label = result.dryRun ? "dry-run" : "apply";
    if (!result.moves.length) {
      console.log(`memory re-wing (${label}): no default-wing notes to move`);
      return EXIT.ok;
    }
    for (const move of result.moves) {
      console.log(`${move.name}: ${move.from} → ${move.to}`);
    }
    console.log(
      `memory re-wing (${label}): planned=${result.planned}${apply ? ` applied=${result.applied}` : ""}`
    );
    return EXIT.ok;
  } catch (e) {
    console.error("memory re-wing: " + (e instanceof ConfigError ? e.message : String(e)));
    return EXIT.config;
  }
}

export async function cmdMemoryLessonEval(argv: string[], opts: MemoryCmdOptions = {}): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  const [action, ...rest] = argv;
  let json = false;
  let promoteFile: string | undefined;
  let tasksFile: string | undefined;
  let out = "Reports/cursor-lesson-eval-sheet.md";
  let note: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--json") json = true;
    else if (a === "--promote-file" && rest[i + 1]) promoteFile = rest[++i];
    else if (a === "--tasks-file" && rest[i + 1]) tasksFile = rest[++i];
    else if (a === "--out" && rest[i + 1]) out = rest[++i];
    else if (a === "--note" && rest[i + 1]) note = rest[++i];
  }
  try {
    loadConfig(dir);
    switch (action) {
      case "validate": {
        const r = validateLessonEvalScaffold(dir, { promoteFile, tasksPath: tasksFile });
        if (json) {
          console.log(JSON.stringify(r, null, 2));
        } else {
          console.log(r.ok ? "lesson-eval validate: ok" : "lesson-eval validate: FAIL");
          for (const e of r.errors) console.error(`  error: ${e}`);
          for (const w of r.warnings) console.log(`  warn: ${w}`);
        }
        return r.ok ? EXIT.ok : EXIT.software;
      }
      case "list": {
        const rows = await buildLessonEvalRows(dir, { promoteFile, tasksPath: tasksFile });
        if (json) {
          console.log(JSON.stringify(rows, null, 2));
        } else {
          for (const row of rows) {
            const verdict = row.verdict?.split(":")[0]?.trim() ?? "—";
            const title = row.title ?? "—";
            console.log(`${row.task.lesson}\t${verdict}\t${title.slice(0, 60)}`);
          }
        }
        return EXIT.ok;
      }
      case "sheet": {
        const outPath = resolveLessonEvalOutPath(dir, out);
        await writeLessonEvalSheet(dir, outPath, { promoteFile, tasksPath: tasksFile });
        console.log(`lesson-eval sheet: ${outPath}`);
        return EXIT.ok;
      }
      case "record": {
        const positional = rest.filter((a) => !a.startsWith("--"));
        const lesson = positional[0];
        const verdict = positional[1] ? parseLessonEvalVerdict(positional[1]) : undefined;
        if (!lesson || !verdict) {
          console.error("usage: csagent memory lesson-eval record <lesson> pass|fail|neutral [--note TEXT]");
          return EXIT.usage;
        }
        const fact = await recordLessonEval(dir, lesson, verdict, note);
        console.log(`lesson-eval record: ${lesson} → ${fact.object} (${fact.id})`);
        return EXIT.ok;
      }
      case "summary": {
        const s = await summarizeLessonEval(dir, { promoteFile, tasksPath: tasksFile });
        if (json) {
          console.log(JSON.stringify(s, null, 2));
        } else {
          for (const row of s.rows) {
            console.log(`${row.lesson}\t${row.verdict ?? "—"}\t${row.taskId ?? ""}`);
          }
          if (s.archiveCandidates.length) {
            console.log(`archive candidates (fail): ${s.archiveCandidates.join(", ")}`);
          }
        }
        return EXIT.ok;
      }
      default:
        console.error(`memory lesson-eval: unknown action '${action ?? ""}'`);
        console.error(`Usage:
  csagent memory lesson-eval validate [--json] [--promote-file PATH] [--tasks-file PATH]
  csagent memory lesson-eval list [--json]
  csagent memory lesson-eval sheet [--out Reports/cursor-lesson-eval-sheet.md]
  csagent memory lesson-eval record <lesson> pass|fail|neutral [--note TEXT]
  csagent memory lesson-eval summary [--json]`);
        return EXIT.usage;
    }
  } catch (e) {
    console.error("memory lesson-eval: " + (e instanceof ConfigError ? e.message : String(e)));
    return EXIT.config;
  }
}

export async function cmdMemoryPurgeArchive(argv: string[], opts: MemoryCmdOptions = {}): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  let wing = CURSOR_TRANSCRIPT_WING;
  let olderThanDays = DEFAULT_ARCHIVE_RETENTION_DAYS;
  let requireLesson = false;
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") apply = true;
    else if (a === "--require-lesson") requireLesson = true;
    else if (a === "--wing" && argv[i + 1]) wing = argv[++i]!;
    else if (a === "--older-than-days" && argv[i + 1]) {
      olderThanDays = Number(argv[++i]);
    }
  }
  if (!Number.isFinite(olderThanDays) || olderThanDays <= 0) {
    console.error("memory purge-archive: --older-than-days must be a positive number");
    return EXIT.usage;
  }
  try {
    loadConfig(dir);
    const result = await purgeArchiveNotes(dir, { wing, olderThanDays, requireLesson, apply });
    const mode = result.dryRun ? "dry-run" : "applied";
    console.log(
      `memory purge-archive (${mode}) wing=${result.wing} older=${result.olderThanDays}d requireLesson=${result.requireLesson}: matched=${result.matched}${apply ? ` deleted=${result.deleted}` : ""}`
    );
    for (const c of result.candidates.slice(0, 25)) {
      console.log(`  ${c.name} (${c.updatedAt}) — ${c.reason}`);
    }
    if (result.candidates.length > 25) {
      console.log(`  … +${result.candidates.length - 25} more`);
    }
    return EXIT.ok;
  } catch (e) {
    console.error("memory purge-archive: " + (e instanceof ConfigError ? e.message : String(e)));
    return EXIT.config;
  }
}

export async function cmdMemory(argv: string[], opts: MemoryCmdOptions = {}): Promise<ExitCode> {
  argv = consumeDirFlag(argv, opts);
  const [sub, name, ...rest] = argv;
  switch (sub) {
    case "align-silo":
      return cmdMemoryAlignSilo(rest, opts);
    case "list":
      return cmdMemoryList(opts);
    case "show":
      return cmdMemoryShow(name ?? "", opts);
    case "search": {
      const args = [name, ...rest].filter((a): a is string => Boolean(a));
      const { wings, rest: queryArgs } = parseMemorySearchWingFlags(args);
      const semantic = queryArgs.includes("--semantic");
      const hybrid = queryArgs.includes("--hybrid");
      const includeArchive = queryArgs.includes("--include-archive");
      const includeEpisodic = queryArgs.includes("--include-episodic");
      const q = queryArgs.filter((a) => !SEARCH_FLAG_RE.test(a)).join(" ");
      return cmdMemorySearch(q, {
        ...opts,
        semantic,
        hybrid,
        includeArchive,
        includeEpisodic,
        wings: wings.length ? wings : undefined,
      });
    }
    case "reindex-embeddings":
      return cmdMemoryReindexEmbeddings(opts);
    case "ingest-sessions":
      return cmdMemoryIngestSessions([name ?? "", ...rest].filter(Boolean), opts);
    case "mine-cursor":
      return cmdMemoryMineCursor([name ?? "", ...rest].filter(Boolean), opts);
    case "distill-cursor":
      return cmdMemoryDistillCursor([name ?? "", ...rest].filter(Boolean), opts);
    case "okf":
      return cmdMemoryOkf([name ?? "", ...rest].filter(Boolean), opts);
    case "fact":
      return cmdMemoryFact([name ?? "", ...rest], opts);
    case "audit":
      return cmdMemoryAudit([name ?? "", ...rest], opts);
    case "re-wing":
      return cmdMemoryReWing([name ?? "", ...rest], opts);
    case "lesson-eval":
      return cmdMemoryLessonEval([name ?? "", ...rest], opts);
    case "purge-archive":
      return cmdMemoryPurgeArchive([name ?? "", ...rest], opts);
    case "import-md":
      return cmdMemoryImportMd([name ?? "", ...rest], opts);
    case "add": {
      const wingFlag = rest.indexOf("--wing");
      let wing: string | undefined;
      let restBody = rest;
      if (wingFlag >= 0) {
        wing = rest[wingFlag + 1];
        restBody = rest.filter((_, i) => i !== wingFlag && i !== wingFlag + 1);
      }
      const useStdin =
        restBody.includes("--stdin") || Boolean(name && restBody.length === 0 && !input.isTTY);
      const body = restBody.filter((a) => a !== "--stdin").join(" ").trim() || undefined;
      return cmdMemoryAdd(name ?? "", body, { ...opts, stdin: useStdin, wing });
    }
    case "rm":
    case "remove":
      return cmdMemoryRm(name ?? "", opts);
    case undefined:
    case "-h":
    case "--help":
    case "help":
      console.log(`Usage:
  csagent memory list                      list stored notes
  csagent memory show <name>               print one note
  csagent memory add <name> [--wing W] [--stdin]
  csagent memory search <query> [--semantic]   keyword (FTS) or vector search
  csagent memory reindex-embeddings        embed notes missing a vector (PG)
  csagent memory ingest-sessions [--window-hours N] [--force]
                                           ingest recent sessions → episodic notes
  csagent memory rm <name>
  csagent memory import-md --kb-root PATH …   (deprecated — use file KB + skill kb-ops)
  csagent memory align-silo [--dry-run]   merge repo/cron silos → canonical ~/.csagent/.agent/memory
  csagent memory audit [--links] [--stale-days N] [--all-notes] [--json]
  csagent memory re-wing [--apply]            move default corpus → tparser/reddit/style (I-81)
  csagent memory lesson-eval validate|list|sheet|record|summary  (I-79 paired eval)
  csagent memory purge-archive [--wing cursor-ide] [--older-than-days 180] [--require-lesson] [--apply]
  csagent memory fact add|query|invalidate …

In chat/TUI, inject with @memory:<name> or @memory: for all.
Notes live in DB (sqlite/postgres) + mirror .agent/memory/*.md for @memory.
`);
      return EXIT.ok;
    default:
      console.error(`unknown memory subcommand: ${sub}\n\nRun: csagent memory help`);
      return EXIT.usage;
  }
}
