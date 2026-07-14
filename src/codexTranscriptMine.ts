/**
 * Mine Codex CLI (~/.codex/sessions) rollout-transcript JSONL into episodic memory notes.
 * Parallel source to src/cursorTranscriptMine.ts and src/claudeCodeTranscriptMine.ts — same
 * options/result shapes and header/hash staleness scheme, different on-disk layout:
 * ~/.codex/sessions/YYYY/MM/DD/rollout-<local-ts>-<uuid>.jsonl, streamed via readline
 * (files observed up to 80+MB / 40k+ lines and actively growing).
 *
 * Discovery: ~/.codex/session_index.jsonl was evaluated as the primary discovery mechanism
 * (per this workflow's live re-verification against real files under ~/.codex/) and rejected:
 * it covers under 5% of sessions (4 lines vs 95 top-level + 269 subagent-forked rollout files
 * on the machine surveyed), goes stale for days at a time, and has no path field — only an
 * `id` that happens to equal the filename's UUID suffix, with no reliable way to derive the
 * YYYY/MM/DD folder from it (updated_at drifts from the folder date; the UUIDv7 embedded
 * timestamp works but relies on undocumented bit layout + local tz assumptions). So discovery
 * here always walks ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl directly (see
 * discoverCodexTranscriptFiles) — there is no index-based fast path to fall back from.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { loadConfig } from "./config.js";
import { createMemoryStore, type IMemoryStore } from "./memoryStore.js";
import { CODEX_TRANSCRIPT_WING } from "./memoryWings.js";
import { redact } from "./redact.js";

export { CODEX_TRANSCRIPT_WING };

/** Cap PG archive size; full jsonl remains on disk (MEMORY-GOVERNANCE D2). */
export const CODEX_ARCHIVE_MAX_BODY_BYTES = 200 * 1024;

export function truncateCodexArchiveBody(
  body: string,
  maxBytes: number = CODEX_ARCHIVE_MAX_BODY_BYTES
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

function finalizeCodexArchiveBody(
  transcriptId: string,
  filePath: string,
  lines: ParsedLine[],
  mtimeIso: string
): string {
  let body = redact(formatCodexTranscriptMarkdown(transcriptId, filePath, lines, mtimeIso));
  body = truncateCodexArchiveBody(body);
  return withHashComment(body, contentHash(body));
}

/** Postgres text rejects NUL; Codex jsonl occasionally contains them. */
export function sanitizeCodexTranscriptText(text: string): string {
  return text.includes("\0") ? text.replace(/\0/g, "") : text;
}

export interface CodexTranscriptMineOptions {
  /** Override ~/.codex/sessions */
  sessionsRoot?: string;
  /** Scan every transcript under sessionsRoot (ignores windowHours/limit). */
  all?: boolean;
  /** Only transcripts modified within this window (default 168h; ignored when all). */
  windowHours?: number;
  /** Max session transcripts per pass (default 30; ignored when all). */
  limit?: number;
  /** Re-ingest even when file mtime and content hash are unchanged. */
  force?: boolean;
  // No includeSubagents: forked-thread files are excluded unconditionally (main thread
  // only) via the session_meta.payload.thread_source==='subagent' check in
  // discoverCodexMainThreadFiles below, so there is nothing to toggle.
}

export interface CodexTranscriptMineResult {
  ingested: number;
  updated: number;
  skipped: number;
  names: string[];
}

interface ParsedLine {
  role: string;
  text: string;
}

interface CodexRawLine {
  type?: string;
  payload?: {
    type?: string;
    message?: string;
    /** Only present on session_meta payloads; 'subagent' marks a forked child thread. */
    thread_source?: string;
  };
}

export function defaultCodexSessionsRoot(): string {
  const env = process.env.CODEX_SESSIONS_ROOT?.trim();
  return env ? resolve(env) : join(homedir(), ".codex", "sessions");
}

export function codexTranscriptNoteName(transcriptId: string): string {
  const id = transcriptId.slice(0, 40);
  const base = `codex.${id}`;
  return base.length <= 64 ? base : `codex.${id.slice(0, 57)}`;
}

/**
 * Stream-parse one rollout jsonl (readline over createReadStream — never readFileSync,
 * files can be 80+MB and actively growing while read). Line shape is
 * {timestamp, type, payload}; only type==='event_msg' with payload.type in
 * {'user_message','agent_message'} is conversational (explicit allowlist — token_count,
 * world_state, turn_context, compacted, thread_settings_applied, mcp_tool_call_end,
 * patch_apply_end, context_compacted, task_started, task_complete, sub_agent_activity,
 * response_item, session_meta, inter_agent_communication_metadata, web_search_end,
 * turn_aborted and any future unrecognized type/payload.type are all silently skipped by
 * simply not matching the allowlist, never treated as errors). Malformed JSON lines are
 * skipped per-line, never fatal to the whole file.
 */
async function parseCodexTranscriptLines(filePath: string): Promise<ParsedLine[]> {
  const out: ParsedLine[] = [];
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let row: CodexRawLine;
      try {
        row = JSON.parse(trimmed) as CodexRawLine;
      } catch {
        continue;
      }
      if (row.type !== "event_msg") continue;
      const kind = row.payload?.type;
      if (kind !== "user_message" && kind !== "agent_message") continue;

      const raw = row.payload?.message;
      const text = typeof raw === "string" ? raw.trim() : "";
      if (text) {
        out.push({ role: kind === "user_message" ? "user" : "assistant", text: sanitizeCodexTranscriptText(text) });
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return out;
}

/**
 * Peek only the FIRST non-empty line of a rollout file to decide whether it is a
 * subagent/forked-thread session (session_meta.payload.thread_source === 'subagent') that
 * must be excluded from the main-thread mining pass. Unlike Claude Code, where subagent
 * turns sit in a structurally separate subagents/ subfolder filterable by path alone with
 * no file opened, Codex forked-thread files are ordinary rollout-*.jsonl siblings in the
 * very same YYYY/MM/DD folder as main threads — there is no clean path- or boolean-level
 * signal, so this cheap bounded peek (one line, stream closed immediately after) is the
 * best available signal. We deliberately do NOT follow forked_from_id/thread_spawn chains
 * to mine subagent content separately; if the first line can't be read/parsed we fail open
 * (treat as main thread) to match the common case where thread_source is simply absent.
 */
async function isCodexSubagentThreadFile(filePath: string): Promise<boolean> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed) as CodexRawLine & { payload?: { thread_source?: string } };
        return row.type === "session_meta" && row.payload?.thread_source === "subagent";
      } catch {
        return false;
      }
    }
    return false;
  } finally {
    rl.close();
    stream.destroy();
  }
}

export function formatCodexTranscriptMarkdown(
  transcriptId: string,
  filePath: string,
  lines: ParsedLine[],
  mtimeIso: string
): string {
  const header = [
    `<!-- csagent codex mine; id=${transcriptId}; mtime=${mtimeIso} -->`,
    `# Codex chat ${transcriptId}`,
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

const CODEX_MINE_META_RE =
  /<!-- csagent codex mine; id=[^;]+; mtime=([\d\-:.TZ]+)\s*(?:; hash=([a-f0-9]+))?\s*-->/;

const CODEX_MINE_MALFORM_HASH_RE =
  /<!-- csagent codex mine; id=[^;]+; mtime=[\d\-:.TZ]+\s*-->\s*;\s*hash=([a-f0-9]+)/;

/** Parse mtime (and optional hash) stored in a mined note header. */
export function parseCodexMineMeta(body: string | undefined): { mtimeMs?: number; hash?: string } {
  if (!body) return {};
  const m = body.match(CODEX_MINE_META_RE);
  let mtimeMs: number | undefined;
  let hash: string | undefined;
  if (m) {
    const parsed = Date.parse(m[1]!);
    mtimeMs = Number.isFinite(parsed) ? parsed : undefined;
    hash = m[2];
  }
  if (!hash) {
    hash = body.match(CODEX_MINE_MALFORM_HASH_RE)?.[1];
  }
  if (mtimeMs === undefined && hash === undefined) return {};
  return { mtimeMs, hash };
}

function stripCodexMineHeader(body: string): string {
  return body
    .replace(/<!-- csagent codex mine[\s\S]*?(?:-->\s*;?\s*hash=[a-f0-9]*)?/i, "")
    .trim();
}

/** Hash from archive meta, malformed suffix, or content (for lineage backfill). */
export function resolveCodexArchiveContentHash(body: string | undefined): string | undefined {
  if (!body) return undefined;
  const meta = parseCodexMineMeta(body);
  if (meta.hash) return meta.hash;
  const stripped = stripCodexMineHeader(body);
  return stripped ? contentHash(stripped) : undefined;
}

/**
 * Fast path: skip reading/parsing jsonl when the on-disk file is not newer than the note.
 * When the transcript grows across sessions, file mtime advances → re-ingest on next pass.
 */
export function codexTranscriptFileStale(
  fileMtimeMs: number,
  existingBody: string | undefined,
  force: boolean
): boolean {
  if (force || !existingBody) return true;
  const stored = parseCodexMineMeta(existingBody);
  if (stored.mtimeMs === undefined) return true;
  return fileMtimeMs > stored.mtimeMs;
}

export function codexNoteNeedsUpdate(
  existingBody: string | undefined,
  newBody: string,
  force: boolean
): boolean {
  if (force || !existingBody) return true;
  const stored = parseCodexMineMeta(existingBody);
  const newHash = parseCodexMineMeta(newBody).hash ?? resolveCodexArchiveContentHash(newBody);
  if (!stored.hash || !newHash) return true;
  return stored.hash !== newHash;
}

const CODEX_MINE_HEADER_BEFORE_CLOSE =
  /(<!-- csagent codex mine; id=[^;]+; mtime=[\d\-:.TZ]+)\s*-->/;

function withHashComment(body: string, hash: string): string {
  const normalized = body.replace(/-->\s*;\s*hash=[a-f0-9]+/, `-->; hash=${hash} -->`);
  if (/; hash=[a-f0-9]+/.test(normalized)) {
    return normalized.replace(/; hash=[a-f0-9]+/, `; hash=${hash}`);
  }
  return normalized.replace(CODEX_MINE_HEADER_BEFORE_CLOSE, `$1; hash=${hash} -->`);
}

/**
 * Recursively walk sessionsRoot (YYYY/MM/DD/rollout-*.jsonl) collecting every rollout file,
 * main-thread and subagent-forked alike — subagent exclusion happens one level up in
 * discoverCodexMainThreadFiles, since telling them apart requires opening each file (see
 * isCodexSubagentThreadFile), not something a pure directory listing can do.
 */
export function discoverCodexTranscriptFiles(sessionsRoot: string): string[] {
  if (!existsSync(sessionsRoot)) return [];
  const files: string[] = [];
  collectCodexRolloutJsonl(sessionsRoot, files);
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

function collectCodexRolloutJsonl(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectCodexRolloutJsonl(full, out);
      continue;
    }
    if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
      out.push(full);
    }
  }
}

/** Discovery + main-thread filter: excludes subagent-forked files (see module header). */
export async function discoverCodexMainThreadFiles(sessionsRoot: string): Promise<string[]> {
  const files = discoverCodexTranscriptFiles(sessionsRoot);
  const mainFiles: string[] = [];
  for (const file of files) {
    if (!(await isCodexSubagentThreadFile(file))) mainFiles.push(file);
  }
  return mainFiles;
}

const CODEX_ROLLOUT_UUID_RE =
  /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/** rollout-<local-ts>-<uuid>.jsonl -> <uuid> (falls back to the bare basename if unmatched). */
export function codexTranscriptIdFromPath(filePath: string): string {
  const base = basename(filePath);
  const m = base.match(CODEX_ROLLOUT_UUID_RE);
  return m ? m[1]! : basename(filePath, ".jsonl");
}

export async function mineCodexTranscripts(
  dir: string,
  opts: CodexTranscriptMineOptions = {}
): Promise<CodexTranscriptMineResult> {
  loadConfig(dir);
  const sessionsRoot = opts.sessionsRoot ?? defaultCodexSessionsRoot();
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
    let files = discoverCodexTranscriptFiles(sessionsRoot);
    if (!scanAll) {
      files = files.filter((f) => statSync(f).mtimeMs >= cutoff);
    }
    const mainFiles: string[] = [];
    for (const f of files) {
      if (!(await isCodexSubagentThreadFile(f))) mainFiles.push(f);
    }
    files = scanAll ? mainFiles : mainFiles.slice(0, limit);

    for (const filePath of files) {
      const stat = statSync(filePath);
      const transcriptId = codexTranscriptIdFromPath(filePath);
      const name = codexTranscriptNoteName(transcriptId);
      const existing = await memory.getNote(name);
      if (!codexTranscriptFileStale(stat.mtimeMs, existing?.body, force)) {
        skipped++;
        continue;
      }

      const lines = await parseCodexTranscriptLines(filePath);
      if (!lines.length) {
        skipped++;
        continue;
      }
      const mtimeIso = stat.mtime.toISOString();
      const body = finalizeCodexArchiveBody(transcriptId, filePath, lines, mtimeIso);

      if (!codexNoteNeedsUpdate(existing?.body, body, force)) {
        skipped++;
        continue;
      }
      const had = Boolean(existing);
      await memory.upsertNote({
        name,
        wing: CODEX_TRANSCRIPT_WING,
        title: `Codex ${transcriptId.slice(0, 8)}…`,
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
export async function mineCodexTranscriptFile(
  memory: IMemoryStore,
  filePath: string,
  opts: { force?: boolean } = {}
): Promise<"ingested" | "updated" | "skipped"> {
  const stat = statSync(filePath);
  const transcriptId = codexTranscriptIdFromPath(filePath);
  const lines = await parseCodexTranscriptLines(filePath);
  if (!lines.length) return "skipped";
  const mtimeIso = stat.mtime.toISOString();
  const body = finalizeCodexArchiveBody(transcriptId, filePath, lines, mtimeIso);
  const name = codexTranscriptNoteName(transcriptId);
  const existing = await memory.getNote(name);
  if (!codexTranscriptFileStale(stat.mtimeMs, existing?.body, opts.force === true)) return "skipped";
  if (!codexNoteNeedsUpdate(existing?.body, body, opts.force === true)) return "skipped";
  await memory.upsertNote({
    name,
    wing: CODEX_TRANSCRIPT_WING,
    title: `Codex ${transcriptId.slice(0, 8)}…`,
    body,
  });
  return existing ? "updated" : "ingested";
}
