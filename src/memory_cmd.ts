/**
 * `csagent memory` — notes + temporal facts (csagent-memory, issue 036+).
 */
import { stdin as input } from "node:process";
import { loadConfig, ConfigError } from "./config.js";
import { importHappyinKb } from "./importHappyinKb.js";
import { MemoryError, deleteMemory, listMemories, readMemory, saveMemory } from "./memory.js";
import { createMemoryStore } from "./memoryStore.js";
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
    await withStore(dir, (s) => s.upsertNote({ name, body, wing: opts.wing }));
    mirrorNoteFile(dir, name, body);
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

export async function cmdMemorySearch(query: string, opts: MemoryCmdOptions = {}): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  if (!query.trim()) {
    console.error("memory search: query required");
    return EXIT.usage;
  }
  try {
    const hits = await withStore(dir, (s) => s.searchNotes(query));
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
  let kbRoot = memoryDir;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--dir" && argv[i + 1]) {
      memoryDir = argv[++i]!;
      kbRoot = memoryDir;
    } else if (a === "--kb-root" && argv[i + 1]) {
      kbRoot = argv[++i]!;
    }
  }
  try {
    const result = await importHappyinKb({ kbRoot, memoryDir, dryRun });
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
    default:
      console.log(`Usage:
  csagent memory fact add <subject> <predicate> <object>
  csagent memory fact query <subject> [predicate]
  csagent memory fact invalidate <fact-id>
`);
      return sub ? EXIT.usage : EXIT.ok;
  }
}

export async function cmdMemory(argv: string[], opts: MemoryCmdOptions = {}): Promise<ExitCode> {
  const [sub, name, ...rest] = argv;
  switch (sub) {
    case "list":
      return cmdMemoryList(opts);
    case "show":
      return cmdMemoryShow(name ?? "", opts);
    case "search":
      return cmdMemorySearch([name, ...rest].filter(Boolean).join(" "), opts);
    case "fact":
      return cmdMemoryFact([name ?? "", ...rest], opts);
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
  csagent memory search <query>            search note bodies
  csagent memory rm <name>
  csagent memory import-md --dir PATH [--kb-root PATH] [--dry-run]
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
