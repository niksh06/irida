/**
 * `csagent memory list|show|add|rm` — durable notes under .agent/memory/ (issue 036).
 */
import { stdin as input } from "node:process";
import { loadConfig, ConfigError } from "./config.js";
import { MemoryError, deleteMemory, listMemories, readMemory, saveMemory } from "./memory.js";
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

export function cmdMemoryList(opts: MemoryCmdOptions = {}): ExitCode {
  const dir = opts.dir ?? process.cwd();
  try {
    loadConfig(dir);
  } catch (e) {
    console.error("memory: " + (e instanceof ConfigError ? e.message : String(e)));
    return EXIT.config;
  }
  const all = listMemories(dir);
  if (all.length === 0) {
    console.log("No memories under .agent/memory/ — use: csagent memory add <name>");
    return EXIT.ok;
  }
  console.log("NAME             TITLE                                    PREVIEW");
  for (const m of all) {
    console.log(
      `${m.name.padEnd(16)} ${m.title.slice(0, 40).padEnd(40)} ${m.preview.slice(0, 48)}`
    );
  }
  return EXIT.ok;
}

export function cmdMemoryShow(name: string, opts: MemoryCmdOptions = {}): ExitCode {
  const dir = opts.dir ?? process.cwd();
  if (!name.trim()) {
    console.error("memory show: name required");
    return EXIT.usage;
  }
  try {
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
  opts: MemoryCmdOptions & { stdin?: boolean } = {}
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
    saveMemory(dir, name, body);
    console.log(`memory: saved ${name} → .agent/memory/${name.replace(/\.md$/i, "")}.md`);
    return EXIT.ok;
  } catch (e) {
    console.error("memory: " + (e instanceof MemoryError ? e.message : String(e)));
    return EXIT.usage;
  }
}

export function cmdMemoryRm(name: string, opts: MemoryCmdOptions = {}): ExitCode {
  const dir = opts.dir ?? process.cwd();
  if (!name.trim()) {
    console.error("memory rm: name required");
    return EXIT.usage;
  }
  try {
    if (deleteMemory(dir, name)) console.log(`memory: removed ${name}`);
    else console.log(`memory: not found: ${name}`);
    return EXIT.ok;
  } catch (e) {
    console.error("memory: " + (e instanceof MemoryError ? e.message : String(e)));
    return EXIT.usage;
  }
}

export async function cmdMemory(argv: string[], opts: MemoryCmdOptions = {}): Promise<ExitCode> {
  const [sub, name, ...rest] = argv;
  switch (sub) {
    case "list":
      return cmdMemoryList(opts);
    case "show":
      return cmdMemoryShow(name ?? "", opts);
    case "add": {
      const useStdin =
        rest.includes("--stdin") || Boolean(name && rest.length === 0 && !input.isTTY);
      const body = rest.filter((a) => a !== "--stdin").join(" ").trim() || undefined;
      return cmdMemoryAdd(name ?? "", body, { ...opts, stdin: useStdin });
    }
    case "rm":
    case "remove":
      return cmdMemoryRm(name ?? "", opts);
    case undefined:
    case "-h":
    case "--help":
    case "help":
      console.log(`Usage:
  csagent memory list                 list stored memories
  csagent memory show <name>          print one memory
  csagent memory add <name> [--stdin] create/update (.agent/memory/<name>.md)
  csagent memory rm <name>            delete memory

In chat/TUI, inject with @memory:<name> or @memory: for all.
`);
      return EXIT.ok;
    default:
      console.error(`unknown memory subcommand: ${sub}\n\nRun: csagent memory help`);
      return EXIT.usage;
  }
}
