/**
 * Expand @file:path and @dir:path tokens into inline prompt context (issue 014).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, normalize } from "node:path";

export class ContextRefError extends Error {}

const FILE_TOKEN = /@file:([^\s]+)/g;
const DIR_TOKEN = /@dir:([^\s]+)/g;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_DIR_ENTRIES = 200;

function safePath(cwd: string, raw: string): string {
  const trimmed = raw.replace(/^['"]|['"]$/g, "");
  const abs = resolve(cwd, trimmed);
  const normCwd = resolve(cwd);
  const rel = relative(normCwd, abs);
  if (rel.startsWith("..") || resolve(abs) === resolve("/")) {
    throw new ContextRefError(`path escapes workspace: ${raw}`);
  }
  return abs;
}

function readFileRef(abs: string, display: string): string {
  if (!existsSync(abs)) throw new ContextRefError(`file not found: ${display}`);
  const st = statSync(abs);
  if (!st.isFile()) throw new ContextRefError(`not a file: ${display}`);
  let buf = readFileSync(abs);
  let truncated = false;
  if (buf.length > MAX_FILE_BYTES) {
    buf = buf.subarray(0, MAX_FILE_BYTES);
    truncated = true;
  }
  const text = buf.toString("utf8");
  const note = truncated ? "\n\n(truncated — file exceeded size limit)\n" : "";
  return `### File: ${display}\n\n\`\`\`\n${text}\n\`\`\`${note}`;
}

function readDirRef(abs: string, display: string): string {
  if (!existsSync(abs)) throw new ContextRefError(`directory not found: ${display}`);
  const st = statSync(abs);
  if (!st.isDirectory()) throw new ContextRefError(`not a directory: ${display}`);
  const names = readdirSync(abs).sort();
  const lines: string[] = [];
  let n = 0;
  for (const name of names) {
    if (n >= MAX_DIR_ENTRIES) {
      lines.push(`… (${names.length - MAX_DIR_ENTRIES} more entries omitted)`);
      break;
    }
    const child = resolve(abs, name);
    let kind = "file";
    try {
      kind = statSync(child).isDirectory() ? "dir" : "file";
    } catch {
      kind = "?";
    }
    lines.push(`${kind}\t${name}`);
    n++;
  }
  return `### Directory: ${display}\n\n\`\`\`\n${lines.join("\n") || "(empty)"}\n\`\`\``;
}

function collectTokens(re: RegExp, prompt: string): string[] {
  re.lastIndex = 0;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) out.push(m[1]);
  return out;
}

export interface ContextRefToken {
  kind: "file" | "dir";
  raw: string;
  display: string;
}

/** List @file / @dir tokens in prompt (deduped, order preserved). */
export function listContextRefs(prompt: string): ContextRefToken[] {
  const seen = new Set<string>();
  const out: ContextRefToken[] = [];
  for (const raw of collectTokens(FILE_TOKEN, prompt)) {
    const key = `file:${raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: "file", raw, display: normalize(raw) });
  }
  for (const raw of collectTokens(DIR_TOKEN, prompt)) {
    const key = `dir:${raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: "dir", raw, display: normalize(raw) });
  }
  return out;
}

export type ContextRefProbe = "ok" | "missing" | "invalid";

/** Check whether a ref resolves inside cwd (for TUI hints). */
export function probeContextRef(cwd: string, token: ContextRefToken): ContextRefProbe {
  try {
    const abs = safePath(cwd, token.raw);
    if (!existsSync(abs)) return "missing";
    const st = statSync(abs);
    if (token.kind === "file" && !st.isFile()) return "invalid";
    if (token.kind === "dir" && !st.isDirectory()) return "invalid";
    return "ok";
  } catch {
    return "invalid";
  }
}

/** Replace @file: and @dir: tokens; append injected blocks after user text. */
export function expandContextRefs(prompt: string, cwd: string): string {
  const filePaths = collectTokens(FILE_TOKEN, prompt);
  const dirPaths = collectTokens(DIR_TOKEN, prompt);
  if (filePaths.length === 0 && dirPaths.length === 0) return prompt;

  const blocks: string[] = [];
  for (const raw of filePaths) {
    const display = normalize(raw);
    blocks.push(readFileRef(safePath(cwd, raw), display));
  }
  for (const raw of dirPaths) {
    const display = normalize(raw);
    blocks.push(readDirRef(safePath(cwd, raw), display));
  }

  FILE_TOKEN.lastIndex = 0;
  DIR_TOKEN.lastIndex = 0;
  const stripped = prompt.replace(FILE_TOKEN, "").replace(DIR_TOKEN, "").trim();
  const task = stripped || "(see attached context)";
  return (
    "The following workspace context was attached via @file / @dir references.\n\n" +
    blocks.join("\n\n") +
    "\n\n# Task\n\n" +
    task
  );
}
