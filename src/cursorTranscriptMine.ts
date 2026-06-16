/**
 * Mine Cursor IDE agent-transcripts JSONL into episodic memory notes (P3-3 / R4-4).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { loadConfig } from "./config.js";
import { createMemoryStore, type IMemoryStore } from "./memoryStore.js";
import { redact } from "./redact.js";
import { CURSOR_TRANSCRIPT_WING } from "./memoryWings.js";

export { CURSOR_TRANSCRIPT_WING };

/** Cap PG archive size; full jsonl remains on disk (MEMORY-GOVERNANCE D2). */
export const CURSOR_ARCHIVE_MAX_BODY_BYTES = 200 * 1024;

export function truncateCursorArchiveBody(
  body: string,
  maxBytes: number = CURSOR_ARCHIVE_MAX_BODY_BYTES
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

function finalizeArchiveBody(
  transcriptId: string,
  filePath: string,
  lines: ParsedLine[],
  mtimeIso: string
): string {
  let body = redact(formatCursorTranscriptMarkdown(transcriptId, filePath, lines, mtimeIso));
  body = truncateCursorArchiveBody(body);
  return withHashComment(body, contentHash(body));
}

/** Postgres text rejects NUL; Cursor jsonl occasionally contains them. */
export function sanitizeTranscriptText(text: string): string {
  return text.includes("\0") ? text.replace(/\0/g, "") : text;
}

export interface CursorTranscriptMineOptions {
  /** Override ~/.cursor/projects */
  projectsRoot?: string;
  /** Scan every transcript under projectsRoot (ignores windowHours/limit). */
  all?: boolean;
  /** Only transcripts modified within this window (default 168h; ignored when all). */
  windowHours?: number;
  /** Max parent transcripts per pass (default 30; ignored when all). */
  limit?: number;
  /** Re-ingest even when file mtime and content hash are unchanged. */
  force?: boolean;
  /** Include subagent transcript folders (default false). */
  includeSubagents?: boolean;
}

export interface CursorTranscriptMineResult {
  ingested: number;
  updated: number;
  skipped: number;
  names: string[];
}

interface ParsedLine {
  role: string;
  text: string;
}

export function defaultCursorProjectsRoot(): string {
  const env = process.env.CURSOR_PROJECTS_ROOT?.trim();
  return env ? resolve(env) : join(homedir(), ".cursor", "projects");
}

export function cursorTranscriptNoteName(transcriptId: string): string {
  const id = transcriptId.replace(/^agent-/, "").slice(0, 40);
  const base = `cursor.${id}`;
  return base.length <= 64 ? base : `cursor.${id.slice(0, 57)}`;
}

function parseTranscriptLines(raw: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as {
        role?: string;
        message?: { content?: Array<{ type?: string; text?: string }> };
      };
      const role = typeof row.role === "string" ? row.role : "unknown";
      const parts = row.message?.content ?? [];
      const textParts: string[] = [];
      for (const part of parts) {
        if (part?.type === "text" && typeof part.text === "string" && part.text.trim()) {
          textParts.push(sanitizeTranscriptText(part.text.trim()));
        }
      }
      if (textParts.length) out.push({ role, text: textParts.join("\n") });
    } catch {
      continue;
    }
  }
  return out;
}

export function formatCursorTranscriptMarkdown(
  transcriptId: string,
  filePath: string,
  lines: ParsedLine[],
  mtimeIso: string
): string {
  const header = [
    `<!-- csagent cursor-ide mine; id=${transcriptId}; mtime=${mtimeIso} -->`,
    `# Cursor chat ${transcriptId}`,
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

const CURSOR_MINE_META_RE =
  /<!-- csagent cursor-ide mine; id=[^;]+; mtime=([\d\-:.TZ]+)\s*(?:; hash=([a-f0-9]+))?\s*-->/;

const CURSOR_MINE_MALFORM_HASH_RE =
  /<!-- csagent cursor-ide mine; id=[^;]+; mtime=[\d\-:.TZ]+\s*-->\s*;\s*hash=([a-f0-9]+)/;

/** Parse mtime (and optional hash) stored in a mined note header. */
export function parseCursorMineMeta(body: string | undefined): { mtimeMs?: number; hash?: string } {
  if (!body) return {};
  const m = body.match(CURSOR_MINE_META_RE);
  let mtimeMs: number | undefined;
  let hash: string | undefined;
  if (m) {
    const parsed = Date.parse(m[1]!);
    mtimeMs = Number.isFinite(parsed) ? parsed : undefined;
    hash = m[2];
  }
  if (!hash) {
    hash = body.match(CURSOR_MINE_MALFORM_HASH_RE)?.[1];
  }
  if (mtimeMs === undefined && hash === undefined) return {};
  return { mtimeMs, hash };
}

function stripCursorMineHeader(body: string): string {
  return body
    .replace(/<!-- csagent cursor-ide mine[\s\S]*?(?:-->\s*;?\s*hash=[a-f0-9]*)?/i, "")
    .trim();
}

/** Hash from archive meta, malformed suffix, or content (for lineage backfill). */
export function resolveArchiveContentHash(body: string | undefined): string | undefined {
  if (!body) return undefined;
  const meta = parseCursorMineMeta(body);
  if (meta.hash) return meta.hash;
  const stripped = stripCursorMineHeader(body);
  return stripped ? contentHash(stripped) : undefined;
}

/**
 * Fast path: skip reading/parsing jsonl when the on-disk file is not newer than the note.
 * When the transcript grows across sessions, file mtime advances → re-ingest on next pass.
 */
export function transcriptFileStale(
  fileMtimeMs: number,
  existingBody: string | undefined,
  force: boolean
): boolean {
  if (force || !existingBody) return true;
  const stored = parseCursorMineMeta(existingBody);
  if (stored.mtimeMs === undefined) return true;
  return fileMtimeMs > stored.mtimeMs;
}

function noteNeedsUpdate(existingBody: string | undefined, newBody: string, force: boolean): boolean {
  if (force || !existingBody) return true;
  const stored = parseCursorMineMeta(existingBody);
  const newHash = contentHash(newBody);
  return stored.hash !== newHash;
}

function withHashComment(body: string, hash: string): string {
  const normalized = body.replace(/-->\s*;\s*hash=[a-f0-9]+/, `-->; hash=${hash} -->`);
  if (/; hash=[a-f0-9]+/.test(normalized)) {
    return normalized.replace(/; hash=[a-f0-9]+/, `; hash=${hash}`);
  }
  return normalized.replace(
    /(<!-- csagent cursor-ide mine; id=[^;]+; mtime=[^\->]+)\s*-->/,
    `$1; hash=${hash} -->`
  );
}

export function discoverCursorTranscriptFiles(
  projectsRoot: string,
  opts: { includeSubagents?: boolean } = {}
): string[] {
  if (!existsSync(projectsRoot)) return [];
  const files: string[] = [];
  for (const projectDir of readdirSync(projectsRoot, { withFileTypes: true })) {
    if (!projectDir.isDirectory()) continue;
    const transcriptsDir = join(projectsRoot, projectDir.name, "agent-transcripts");
    if (!existsSync(transcriptsDir)) continue;
    collectTranscriptJsonl(transcriptsDir, files, opts.includeSubagents === true);
  }
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

function collectTranscriptJsonl(dir: string, out: string[], includeSubagents: boolean): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "subagents" && !includeSubagents) continue;
      collectTranscriptJsonl(full, out, includeSubagents);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(full);
  }
}

export function transcriptIdFromPath(filePath: string): string {
  return basename(filePath, ".jsonl");
}

export async function mineCursorTranscripts(
  dir: string,
  opts: CursorTranscriptMineOptions = {}
): Promise<CursorTranscriptMineResult> {
  loadConfig(dir);
  const projectsRoot = opts.projectsRoot ?? defaultCursorProjectsRoot();
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
    let files = discoverCursorTranscriptFiles(projectsRoot, {
      includeSubagents: opts.includeSubagents,
    });
    if (!scanAll) {
      files = files.filter((f) => statSync(f).mtimeMs >= cutoff).slice(0, limit);
    }

    for (const filePath of files) {
      const stat = statSync(filePath);
      const transcriptId = transcriptIdFromPath(filePath);
      const name = cursorTranscriptNoteName(transcriptId);
      const existing = await memory.getNote(name);
      if (!transcriptFileStale(stat.mtimeMs, existing?.body, force)) {
        skipped++;
        continue;
      }

      const raw = readFileSync(filePath, "utf8");
      const lines = parseTranscriptLines(raw);
      if (!lines.length) {
        skipped++;
        continue;
      }
      const mtimeIso = stat.mtime.toISOString();
      const body = finalizeArchiveBody(transcriptId, filePath, lines, mtimeIso);

      if (!noteNeedsUpdate(existing?.body, body, force)) {
        skipped++;
        continue;
      }
      const had = Boolean(existing);
      await memory.upsertNote({
        name,
        wing: CURSOR_TRANSCRIPT_WING,
        title: `Cursor ${transcriptId.slice(0, 8)}…`,
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
export async function mineCursorTranscriptFile(
  memory: IMemoryStore,
  filePath: string,
  opts: { force?: boolean } = {}
): Promise<"ingested" | "updated" | "skipped"> {
  const stat = statSync(filePath);
  const transcriptId = transcriptIdFromPath(filePath);
  const lines = parseTranscriptLines(readFileSync(filePath, "utf8"));
  if (!lines.length) return "skipped";
  const mtimeIso = stat.mtime.toISOString();
  const body = finalizeArchiveBody(transcriptId, filePath, lines, mtimeIso);
  const name = cursorTranscriptNoteName(transcriptId);
  const existing = await memory.getNote(name);
  if (!transcriptFileStale(stat.mtimeMs, existing?.body, opts.force === true)) return "skipped";
  if (!noteNeedsUpdate(existing?.body, body, opts.force === true)) return "skipped";
  await memory.upsertNote({
    name,
    wing: CURSOR_TRANSCRIPT_WING,
    title: `Cursor ${transcriptId.slice(0, 8)}…`,
    body,
  });
  return existing ? "updated" : "ingested";
}
