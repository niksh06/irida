/**
 * Mine Claude Code CLI (code.claude.com) session-transcript JSONL into episodic memory notes.
 * Parallel source to src/cursorTranscriptMine.ts — same options/result shapes and header/hash
 * staleness scheme, different on-disk layout: ~/.claude/projects/<url-encoded-cwd>/<uuid>.jsonl,
 * streamed via readline (files can be 60-120+MB and actively growing).
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { loadConfig } from "./config.js";
import { createMemoryStore, type IMemoryStore } from "./memoryStore.js";
import { CLAUDE_CODE_TRANSCRIPT_WING } from "./memoryWings.js";
import { redact } from "./redact.js";

export { CLAUDE_CODE_TRANSCRIPT_WING };

/** Cap PG archive size; full jsonl remains on disk (MEMORY-GOVERNANCE D2). */
export const CLAUDE_CODE_ARCHIVE_MAX_BODY_BYTES = 200 * 1024;

export function truncateClaudeCodeArchiveBody(
  body: string,
  maxBytes: number = CLAUDE_CODE_ARCHIVE_MAX_BODY_BYTES
): string {
  if (Buffer.byteLength(body, "utf8") <= maxBytes) return body;
  const footer = `\n\n<!-- truncated: archive body capped at ${maxBytes} bytes; full transcript on disk -->\n`;
  let budget = maxBytes - Buffer.byteLength(footer, "utf8");
  if (budget < 256) budget = 256;
  const buf = Buffer.from(body, "utf8");
  let cut = Math.min(budget, buf.length);
  while (cut > 0 && (buf[cut]! & 0xc0) === 0x80) cut--;
  return `${buf.subarray(0, cut).toString("utf8")}${footer}`;
}

function finalizeClaudeCodeArchiveBody(
  transcriptId: string,
  filePath: string,
  lines: ParsedLine[],
  mtimeIso: string
): string {
  let body = redact(formatClaudeCodeTranscriptMarkdown(transcriptId, filePath, lines, mtimeIso));
  body = truncateClaudeCodeArchiveBody(body);
  return withHashComment(body, contentHash(body));
}

/** Postgres text rejects NUL; Claude Code jsonl occasionally contains them. */
export function sanitizeClaudeCodeTranscriptText(text: string): string {
  return text.includes("\0") ? text.replace(/\0/g, "") : text;
}

export interface ClaudeCodeTranscriptMineOptions {
  /** Override ~/.claude/projects */
  projectsRoot?: string;
  /** Scan every transcript under projectsRoot (ignores windowHours/limit). */
  all?: boolean;
  /** Only transcripts modified within this window (default 168h; ignored when all). */
  windowHours?: number;
  /** Max session transcripts per pass (default 30; ignored when all). */
  limit?: number;
  /** Re-ingest even when file mtime and content hash are unchanged. */
  force?: boolean;
  // No includeSubagents: sidechain filtering below is unconditional (main thread
  // only), and subagent turns live in a separate file tree we never discover into
  // (see discoverClaudeCodeTranscriptFiles), so there is nothing to toggle.
}

export interface ClaudeCodeTranscriptMineResult {
  ingested: number;
  updated: number;
  skipped: number;
  names: string[];
}

interface ParsedLine {
  role: string;
  text: string;
}

interface ClaudeCodeContentBlock {
  type?: string;
  text?: string;
}

interface ClaudeCodeRawLine {
  type?: string;
  isSidechain?: boolean;
  message?: {
    role?: string;
    content?: string | ClaudeCodeContentBlock[];
  };
}

export function defaultClaudeCodeProjectsRoot(): string {
  const env = process.env.CLAUDE_CODE_PROJECTS_ROOT?.trim();
  return env ? resolve(env) : join(homedir(), ".claude", "projects");
}

export function claudeCodeTranscriptNoteName(transcriptId: string): string {
  const id = transcriptId.slice(0, 40);
  const base = `cc.${id}`;
  return base.length <= 64 ? base : `cc.${id.slice(0, 57)}`;
}

/**
 * Stream-parse one session jsonl (readline over createReadStream — never
 * readFileSync, files can be 60-120+MB and actively growing while read).
 * Only type==='user'/'assistant' lines are conversational (explicit allowlist:
 * unrecognized future types are silently skipped, not treated as errors);
 * isSidechain===true lines (subagent branches) are dropped; malformed JSON
 * lines are skipped per-line, never fatal to the whole file.
 */
async function parseClaudeCodeTranscriptLines(filePath: string): Promise<ParsedLine[]> {
  const out: ParsedLine[] = [];
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let row: ClaudeCodeRawLine;
      try {
        row = JSON.parse(trimmed) as ClaudeCodeRawLine;
      } catch {
        continue;
      }
      const role = row.type;
      if (role !== "user" && role !== "assistant") continue;
      if (row.isSidechain === true) continue;

      const content = row.message?.content;
      let text = "";
      if (typeof content === "string") {
        text = content.trim();
      } else if (Array.isArray(content)) {
        const textParts: string[] = [];
        for (const block of content) {
          if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
            textParts.push(block.text.trim());
          }
        }
        text = textParts.join("\n");
      }
      if (text) out.push({ role, text: sanitizeClaudeCodeTranscriptText(text) });
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return out;
}

export function formatClaudeCodeTranscriptMarkdown(
  transcriptId: string,
  filePath: string,
  lines: ParsedLine[],
  mtimeIso: string
): string {
  const header = [
    `<!-- csagent claude-code mine; id=${transcriptId}; mtime=${mtimeIso} -->`,
    `# Claude Code chat ${transcriptId}`,
    "",
    `_Source: ${basename(filePath)}_`,
    "",
  ];
  const body: string[] = [];
  for (const row of lines) {
    if (row.role === "user") {
      body.push(`## User`, "", row.text, "");
    } else if (row.role === "assistant") {
      body.push(`## Assistant`, "", row.text, "");
    }
  }
  const joined = [...header, ...body].join("\n").trimEnd();
  return joined.endsWith("\n") ? joined : `${joined}\n`;
}

function contentHash(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

const CLAUDE_CODE_MINE_META_RE =
  /<!-- csagent claude-code mine; id=[^;]+; mtime=([\d\-:.TZ]+)\s*(?:; hash=([a-f0-9]+))?\s*-->/;

const CLAUDE_CODE_MINE_MALFORM_HASH_RE =
  /<!-- csagent claude-code mine; id=[^;]+; mtime=[\d\-:.TZ]+\s*-->\s*;\s*hash=([a-f0-9]+)/;

/** Parse mtime (and optional hash) stored in a mined note header. */
export function parseClaudeCodeMineMeta(body: string | undefined): { mtimeMs?: number; hash?: string } {
  if (!body) return {};
  const m = body.match(CLAUDE_CODE_MINE_META_RE);
  let mtimeMs: number | undefined;
  let hash: string | undefined;
  if (m) {
    const parsed = Date.parse(m[1]!);
    mtimeMs = Number.isFinite(parsed) ? parsed : undefined;
    hash = m[2];
  }
  if (!hash) {
    hash = body.match(CLAUDE_CODE_MINE_MALFORM_HASH_RE)?.[1];
  }
  if (mtimeMs === undefined && hash === undefined) return {};
  return { mtimeMs, hash };
}

function stripClaudeCodeMineHeader(body: string): string {
  return body
    .replace(/<!-- csagent claude-code mine[\s\S]*?(?:-->\s*;?\s*hash=[a-f0-9]*)?/i, "")
    .trim();
}

/** Hash from archive meta, malformed suffix, or content (for lineage backfill). */
export function resolveClaudeCodeArchiveContentHash(body: string | undefined): string | undefined {
  if (!body) return undefined;
  const meta = parseClaudeCodeMineMeta(body);
  if (meta.hash) return meta.hash;
  const stripped = stripClaudeCodeMineHeader(body);
  return stripped ? contentHash(stripped) : undefined;
}

/**
 * Fast path: skip reading/parsing jsonl when the on-disk file is not newer than the note.
 * When the transcript grows across sessions, file mtime advances → re-ingest on next pass.
 */
export function claudeCodeTranscriptFileStale(
  fileMtimeMs: number,
  existingBody: string | undefined,
  force: boolean
): boolean {
  if (force || !existingBody) return true;
  const stored = parseClaudeCodeMineMeta(existingBody);
  if (stored.mtimeMs === undefined) return true;
  return fileMtimeMs > stored.mtimeMs;
}

export function claudeCodeNoteNeedsUpdate(
  existingBody: string | undefined,
  newBody: string,
  force: boolean
): boolean {
  if (force || !existingBody) return true;
  const stored = parseClaudeCodeMineMeta(existingBody);
  const newHash = parseClaudeCodeMineMeta(newBody).hash ?? resolveClaudeCodeArchiveContentHash(newBody);
  if (!stored.hash || !newHash) return true;
  return stored.hash !== newHash;
}

const CLAUDE_CODE_MINE_HEADER_BEFORE_CLOSE =
  /(<!-- csagent claude-code mine; id=[^;]+; mtime=[\d\-:.TZ]+)\s*-->/;

function withHashComment(body: string, hash: string): string {
  const normalized = body.replace(/-->\s*;\s*hash=[a-f0-9]+/, `-->; hash=${hash} -->`);
  if (/; hash=[a-f0-9]+/.test(normalized)) {
    return normalized.replace(/; hash=[a-f0-9]+/, `; hash=${hash}`);
  }
  return normalized.replace(CLAUDE_CODE_MINE_HEADER_BEFORE_CLOSE, `$1; hash=${hash} -->`);
}

export function discoverClaudeCodeTranscriptFiles(projectsRoot: string): string[] {
  if (!existsSync(projectsRoot)) return [];
  const files: string[] = [];
  for (const projectDir of readdirSync(projectsRoot, { withFileTypes: true })) {
    if (!projectDir.isDirectory()) continue;
    const dir = join(projectsRoot, projectDir.name);
    // Session transcripts sit directly in the project dir as <uuid>.jsonl; subagent
    // turns live in a sibling <uuid>/subagents/** tree that is never walked here —
    // every line there is isSidechain:true and would be dropped by the filter in
    // parseClaudeCodeTranscriptLines anyway, so skipping the recursion avoids
    // opening files we'd discard 100% of the content of.
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(join(dir, entry.name));
      }
    }
  }
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

function transcriptIdFromPath(filePath: string): string {
  return basename(filePath, ".jsonl");
}

export async function mineClaudeCodeTranscripts(
  dir: string,
  opts: ClaudeCodeTranscriptMineOptions = {}
): Promise<ClaudeCodeTranscriptMineResult> {
  loadConfig(dir);
  const projectsRoot = opts.projectsRoot ?? defaultClaudeCodeProjectsRoot();
  const scanAll = opts.all === true;
  const windowMs = Math.max(1, opts.windowHours ?? 168) * 3600_000;
  const cutoff = Date.now() - windowMs;
  const limit = scanAll ? Number.POSITIVE_INFINITY : Math.max(1, opts.limit ?? 30);
  const force = opts.force === true;

  const memory = createMemoryStore(dir);
  const names: string[] = [];
  let ingested = 0;
  let updated = 0;
  let skipped = 0;

  try {
    let files = discoverClaudeCodeTranscriptFiles(projectsRoot);
    if (!scanAll) {
      files = files.filter((f) => statSync(f).mtimeMs >= cutoff).slice(0, limit);
    }

    for (const filePath of files) {
      const stat = statSync(filePath);
      const transcriptId = transcriptIdFromPath(filePath);
      const name = claudeCodeTranscriptNoteName(transcriptId);
      const existing = await memory.getNote(name);
      if (!claudeCodeTranscriptFileStale(stat.mtimeMs, existing?.body, force)) {
        skipped++;
        continue;
      }

      const lines = await parseClaudeCodeTranscriptLines(filePath);
      if (!lines.length) {
        skipped++;
        continue;
      }
      const mtimeIso = stat.mtime.toISOString();
      const body = finalizeClaudeCodeArchiveBody(transcriptId, filePath, lines, mtimeIso);

      if (!claudeCodeNoteNeedsUpdate(existing?.body, body, force)) {
        skipped++;
        continue;
      }
      const had = Boolean(existing);
      await memory.upsertNote({
        name,
        wing: CLAUDE_CODE_TRANSCRIPT_WING,
        title: `Claude Code ${transcriptId.slice(0, 8)}…`,
        body,
      });
      names.push(name);
      if (had) updated++;
      else ingested++;
    }
  } finally {
    await memory.close();
  }

  return { ingested, updated, skipped, names };
}

/** Test hook: ingest one file through injected memory store. */
export async function mineClaudeCodeTranscriptFile(
  memory: IMemoryStore,
  filePath: string,
  opts: { force?: boolean } = {}
): Promise<"ingested" | "updated" | "skipped"> {
  const stat = statSync(filePath);
  const transcriptId = transcriptIdFromPath(filePath);
  const lines = await parseClaudeCodeTranscriptLines(filePath);
  if (!lines.length) return "skipped";
  const mtimeIso = stat.mtime.toISOString();
  const body = finalizeClaudeCodeArchiveBody(transcriptId, filePath, lines, mtimeIso);
  const name = claudeCodeTranscriptNoteName(transcriptId);
  const existing = await memory.getNote(name);
  if (!claudeCodeTranscriptFileStale(stat.mtimeMs, existing?.body, opts.force === true)) return "skipped";
  if (!claudeCodeNoteNeedsUpdate(existing?.body, body, opts.force === true)) return "skipped";
  await memory.upsertNote({
    name,
    wing: CLAUDE_CODE_TRANSCRIPT_WING,
    title: `Claude Code ${transcriptId.slice(0, 8)}…`,
    body,
  });
  return existing ? "updated" : "ingested";
}
