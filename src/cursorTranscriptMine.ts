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

export const CURSOR_TRANSCRIPT_WING = "cursor-ide";

export interface CursorTranscriptMineOptions {
  /** Override ~/.cursor/projects */
  projectsRoot?: string;
  /** Only transcripts modified within this window (default 168h). */
  windowHours?: number;
  /** Max parent transcripts per pass (default 30). */
  limit?: number;
  /** Re-ingest when file mtime unchanged but --force. */
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
          textParts.push(part.text.trim());
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

function noteNeedsUpdate(existingBody: string | undefined, newBody: string, force: boolean): boolean {
  if (force || !existingBody) return true;
  const oldHash = existingBody.match(/<!-- csagent cursor-ide mine; id=[^;]+; mtime=[^>]+; hash=([a-f0-9]+)/)?.[1];
  const newHash = contentHash(newBody);
  return oldHash !== newHash;
}

function withHashComment(body: string, hash: string): string {
  if (body.includes("hash=")) {
    return body.replace(/hash=[a-f0-9]+/, `hash=${hash}`);
  }
  return body.replace(
    /(<!-- csagent cursor-ide mine; id=[^;]+; mtime=[^>]+ -->)/,
    `$1; hash=${hash}`
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
  const windowMs = Math.max(1, opts.windowHours ?? 168) * 3600_000;
  const cutoff = Date.now() - windowMs;
  const limit = Math.max(1, opts.limit ?? 30);
  const force = opts.force === true;

  const memory = createMemoryStore(dir);
  const names: string[] = [];
  let ingested = 0;
  let updated = 0;
  let skipped = 0;

  try {
    const files = discoverCursorTranscriptFiles(projectsRoot, {
      includeSubagents: opts.includeSubagents,
    }).filter((f) => statSync(f).mtimeMs >= cutoff);

    for (const filePath of files.slice(0, limit)) {
      const stat = statSync(filePath);
      const transcriptId = transcriptIdFromPath(filePath);
      const raw = readFileSync(filePath, "utf8");
      const lines = parseTranscriptLines(raw);
      if (!lines.length) {
        skipped++;
        continue;
      }
      const mtimeIso = stat.mtime.toISOString();
      let body = redact(formatCursorTranscriptMarkdown(transcriptId, filePath, lines, mtimeIso));
      const hash = contentHash(body);
      body = withHashComment(body, hash);

      const name = cursorTranscriptNoteName(transcriptId);
      const existing = await memory.getNote(name);
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
  let body = redact(formatCursorTranscriptMarkdown(transcriptId, filePath, lines, mtimeIso));
  body = withHashComment(body, contentHash(body));
  const name = cursorTranscriptNoteName(transcriptId);
  const existing = await memory.getNote(name);
  if (!noteNeedsUpdate(existing?.body, body, opts.force === true)) return "skipped";
  await memory.upsertNote({
    name,
    wing: CURSOR_TRANSCRIPT_WING,
    title: `Cursor ${transcriptId.slice(0, 8)}…`,
    body,
  });
  return existing ? "updated" : "ingested";
}
