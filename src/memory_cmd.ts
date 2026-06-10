/**
 * `csagent memory` — notes + temporal facts (csagent-memory, issue 036+).
 */
import { stdin as input } from "node:process";
import { loadConfig, ConfigError } from "./config.js";
import { importHappyinKb } from "./importHappyinKb.js";
import { MemoryError, deleteMemory, listMemories, readMemory, saveMemory } from "./memory.js";
import { alignMemorySilos } from "./memorySiloOps.js";
import { createMemoryStore, SECURE_WING } from "./memoryStore.js";
import {
  evaluateMemoryAudit,
  formatMemoryAuditReport,
  saveMemoryAuditResult,
  DEFAULT_STALE_DAYS,
} from "./memoryAudit.js";
import { parseOlderThanDays, pruneSeenPostFacts, SEEN_POST_TTL_DAYS } from "./memoryFactPrune.js";
import { EXIT, type ExitCode } from "./exit.js";

export interface MemoryCmdOptions {
  dir?: string;
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
    const removed = await withStore(dir, (s) => s.deleteNote(name));
    const fileRemoved = deleteMemory(dir, name);
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
  opts: MemoryCmdOptions & { semantic?: boolean } = {}
): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  if (!query.trim()) {
    console.error("memory search: query required");
    return EXIT.usage;
  }
  try {
    const hits = await withStore(dir, async (s) => {
      if (opts.semantic) {
        if (!s.searchNotesSemantic) {
          throw new MemoryError(
            "--semantic requires Postgres + memory.embeddings.enabled (see REFERENCE.md)"
          );
        }
        const semantic = await s.searchNotesSemantic(query);
        if (semantic.length > 0) return semantic;
        // Embedding daemon down or nothing indexed → keyword fallback.
        return s.searchNotes(query);
      }
      return s.searchNotes(query);
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
      const fact = await withStore(dir, (s) => s.addFact({ subject, predicate, object }));
      console.log(`fact: ${fact.id}  ${fact.subject} ${fact.predicate} ${fact.object}`);
      return EXIT.ok;
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
  csagent memory fact prune seen_post --older-than 30d [--dry-run]
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

export async function cmdMemory(argv: string[], opts: MemoryCmdOptions = {}): Promise<ExitCode> {
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
      const semantic = args.includes("--semantic");
      const q = args.filter((a) => a !== "--semantic").join(" ");
      return cmdMemorySearch(q, { ...opts, semantic });
    }
    case "reindex-embeddings":
      return cmdMemoryReindexEmbeddings(opts);
    case "fact":
      return cmdMemoryFact([name ?? "", ...rest], opts);
    case "audit":
      return cmdMemoryAudit([name ?? "", ...rest], opts);
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
  csagent memory rm <name>
  csagent memory import-md --kb-root PATH [--dir CSAGENT_ROOT] [--domains kafka,python] [--dry-run]
  csagent memory align-silo [--dry-run]   merge repo/cron silos → canonical ~/.csagent/.agent/memory
  csagent memory audit [--links] [--stale-days N] [--all-notes] [--json]
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
