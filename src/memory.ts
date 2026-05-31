/**
 * Durable user/project memory under .agent/memory/ (issue 036).
 * Injected via @memory:name tokens; content redacted on write.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve, basename, extname } from "node:path";
import { loadConfig, type AgentConfig } from "./config.js";
import { createMemoryStore } from "./memoryStore.js";
import { redact } from "./redact.js";

export class MemoryError extends Error {}

export const MEMORY_SUBDIR = "memory";
const MAX_NAME_LEN = 64;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_CHARS = 32 * 1024;

const MEMORY_TOKEN = /@memory:([^\s]*)/g;

export interface MemoryEntry {
  name: string;
  path: string;
  title: string;
  preview: string;
}

export interface MemoryRefToken {
  name: string;
  /** Empty string = inject all memories. */
  display: string;
}

function sanitizeName(raw: string): string {
  const name = raw.trim().replace(/\.md$/i, "");
  if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new MemoryError(`invalid memory name '${raw}' (use letters, digits, ._-)`);
  }
  if (name.length > MAX_NAME_LEN) throw new MemoryError(`memory name too long: ${raw}`);
  return name;
}

export function memoryDir(dir: string = process.cwd()): string {
  const cfg = loadConfig(dir);
  return resolve(dir, cfg.stateDir, MEMORY_SUBDIR);
}

function ensureMemoryDir(dir: string): string {
  const root = memoryDir(dir);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}

function memoryPath(dir: string, name: string): string {
  const safe = sanitizeName(name);
  return resolve(ensureMemoryDir(dir), `${safe}.md`);
}

function titleFromContent(name: string, body: string): string {
  const m = body.match(/^#\s+(.+)$/m);
  return m?.[1]?.trim() || name;
}

function readBody(abs: string, display: string): string {
  if (!existsSync(abs)) throw new MemoryError(`memory not found: ${display}`);
  let buf = readFileSync(abs);
  let truncated = false;
  if (buf.length > MAX_FILE_BYTES) {
    buf = buf.subarray(0, MAX_FILE_BYTES);
    truncated = true;
  }
  const text = redact(buf.toString("utf8"));
  return truncated ? `${text}\n\n(truncated — memory file exceeded size limit)\n` : text;
}

export function listMemories(dir: string = process.cwd()): MemoryEntry[] {
  const root = memoryDir(dir);
  if (!existsSync(root)) return [];
  const out: MemoryEntry[] = [];
  for (const file of readdirSync(root).sort()) {
    if (extname(file).toLowerCase() !== ".md") continue;
    const name = basename(file, ".md");
    const path = resolve(root, file);
    let body = "";
    try {
      body = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const preview = body.replace(/\s+/g, " ").trim().slice(0, 80);
    out.push({ name, path, title: titleFromContent(name, body), preview });
  }
  return out;
}

export function readMemory(dir: string, name: string): string {
  return readBody(memoryPath(dir, name), sanitizeName(name));
}

export function saveMemory(dir: string, name: string, body: string): void {
  const text = redact(body.trim());
  if (!text) throw new MemoryError("memory body must be non-empty");
  writeFileSync(memoryPath(dir, name), text.endsWith("\n") ? text : `${text}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function deleteMemory(dir: string, name: string): boolean {
  const path = memoryPath(dir, name);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export function listMemoryRefs(prompt: string): MemoryRefToken[] {
  MEMORY_TOKEN.lastIndex = 0;
  const seen = new Set<string>();
  const out: MemoryRefToken[] = [];
  let m: RegExpExecArray | null;
  while ((m = MEMORY_TOKEN.exec(prompt)) !== null) {
    const raw = m[1] ?? "";
    const key = raw || "*";
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: raw, display: raw || "(all)" });
  }
  return out;
}

function formatMemoryBlock(name: string, body: string): string {
  return `### Memory: ${name}\n\n${body.trim()}`;
}

/** Load configured notes for the first turn of a chat session. */
export async function sessionStartMemoryBlocks(
  dir: string,
  cfg: AgentConfig
): Promise<string[]> {
  const onStart = cfg.memory?.onStart;
  if (!onStart?.length) return [];

  const maxChars = cfg.memory.maxCharsPerTurn ?? MAX_TOTAL_CHARS;
  const store = createMemoryStore(dir, cfg.stateDir);
  const blocks: string[] = [];
  let total = 0;

  try {
    const loadOne = async (name: string): Promise<string | undefined> => {
      const note = await store.getNote(name);
      if (note) return note.body;
      try {
        return readMemory(dir, name);
      } catch {
        return undefined;
      }
    };

    if (onStart.length === 1 && onStart[0] === "*") {
      const notes = await store.listNotes();
      if (notes.length > 0) {
        for (const n of notes) {
          if (total + n.body.length > maxChars) break;
          blocks.push(formatMemoryBlock(n.name, n.body));
          total += n.body.length;
        }
      } else {
        for (const entry of listMemories(dir)) {
          const body = readMemory(dir, entry.name);
          if (total + body.length > maxChars) break;
          blocks.push(formatMemoryBlock(entry.name, body));
          total += body.length;
        }
      }
      return blocks;
    }

    for (const raw of onStart) {
      const name = raw.trim();
      if (!name || name === "*") continue;
      const body = await loadOne(name);
      if (!body) continue;
      if (total + body.length > maxChars) break;
      blocks.push(formatMemoryBlock(name, body));
      total += body.length;
    }
    return blocks;
  } finally {
    await store.close();
  }
}

function loadMemoriesForToken(dir: string, tokenName: string): string[] {
  if (!tokenName.trim()) {
    const all = listMemories(dir);
    if (all.length === 0) throw new MemoryError("no memories stored — use csagent memory add");
    let total = 0;
    const blocks: string[] = [];
    for (const entry of all) {
      const body = readMemory(dir, entry.name);
      if (total + body.length > MAX_TOTAL_CHARS) break;
      blocks.push(formatMemoryBlock(entry.name, body));
      total += body.length;
    }
    if (blocks.length === 0) throw new MemoryError("memories exceed total size limit");
    return blocks;
  }
  const name = sanitizeName(tokenName);
  return [formatMemoryBlock(name, readMemory(dir, name))];
}

/** Replace @memory: tokens; optional prepend blocks (session start). */
export function expandMemoryRefs(
  prompt: string,
  dir: string = process.cwd(),
  prependBlocks: string[] = []
): string {
  const tokens = listMemoryRefs(prompt);
  const blocks: string[] = [...prependBlocks];
  for (const t of tokens) {
    blocks.push(...loadMemoriesForToken(dir, t.name));
  }
  if (blocks.length === 0) return prompt;

  MEMORY_TOKEN.lastIndex = 0;
  const stripped = prompt.replace(MEMORY_TOKEN, "").trim();
  const task = stripped || "(see attached memory)";
  const header = prependBlocks.length
    ? "The following durable memory was loaded for this session.\n\n"
    : "The following durable memory was attached via @memory references.\n\n";
  return header + blocks.join("\n\n") + "\n\n# Task\n\n" + task;
}

export function probeMemoryRef(dir: string, token: MemoryRefToken): "ok" | "missing" {
  if (!token.name.trim()) return listMemories(dir).length > 0 ? "ok" : "missing";
  const path = resolve(memoryDir(dir), `${sanitizeName(token.name)}.md`);
  return existsSync(path) ? "ok" : "missing";
}
