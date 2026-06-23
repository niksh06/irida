/**
 * Ingest session transcripts into csagent-memory as searchable episodic notes (P3-2).
 * Idempotent: skips when the note is already up to date with session.updated_at.
 */
import { loadConfig } from "./config.js";
import { createMemoryStore, type IMemoryStore } from "./memoryStore.js";
import { createStore, type RunRecord, type SessionRecord } from "./store.js";
import { formatSessionRunsMarkdown } from "./sessionExport.js";
import { basename, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

/** Wing for auto-ingested session summaries — excluded from @memory:* bulk load. */
export const EPISODIC_WING = "episodic";

export interface SessionIngestOptions {
  /** Sessions updated within this window (default 168h = 7 days). */
  windowHours?: number;
  /** Max sessions per pass (default 50). */
  limit?: number;
  /** Re-ingest even when note.updated_at >= session.updated_at. */
  force?: boolean;
}

export interface SessionIngestResult {
  ingested: number;
  skipped: number;
  updated: number;
  /** Note names written or refreshed. */
  names: string[];
}

export function episodicNoteName(sessionId: string): string {
  const base = `ep.${sessionId.trim()}`;
  return base.length <= 64 ? base : `ep.${sessionId.trim().slice(0, 60)}`;
}

/** Burst/temp cwd patterns that pollute episodic memory (I-68 / I-27 extension). */
const EPISODIC_NOISE_CWD_RE = /^(rotate-fail|chat-)/;

export function isEpisodicNoiseCwd(cwd: string): boolean {
  const resolved = resolve(cwd);
  const tmpRoot = resolve(tmpdir());
  if (!resolved.startsWith(tmpRoot + sep) && resolved !== tmpRoot) return false;
  return EPISODIC_NOISE_CWD_RE.test(basename(resolved));
}

/** One-word greetings/acks/test pings that, with no real work, are pure recall noise. */
const TRIVIAL_TITLE_RE = /^(hello|hi|hey|yo|ok|okay|k|test|testing|ping|once|q|x|t|\.|\?|)$/i;

/**
 * Trivial = a junk/greeting title AND no substantive work (≥2 finished non-test
 * runs). Catches the "hello"/"t"/"once" sessions that polluted episodic recall
 * (memory quality review 2026-06-23: 82/246 episodic notes were junk-titled),
 * while a junk-titled session that DID real multi-turn work is still kept.
 */
export function isTrivialSession(session: SessionRecord, runs: RunRecord[]): boolean {
  const title = (session.title ?? "").trim();
  if (!TRIVIAL_TITLE_RE.test(title)) return false;
  const substantive = runs.filter((r) => r.is_test !== true && r.status === "finished").length;
  return substantive < 2;
}

/** Skip test/temp cwd + trivial sessions from nightly episodic ingest (I-68 / I-27 / I-123). */
export function shouldSkipEpisodicIngest(session: SessionRecord, runs: RunRecord[]): boolean {
  if (isEpisodicNoiseCwd(session.cwd)) return true;
  if (isTrivialSession(session, runs)) return true;
  return runs.some((r) => r.is_test === true && isEpisodicNoiseCwd(r.cwd));
}

function sessionNeedsIngest(
  session: SessionRecord,
  existingUpdatedAt: string | undefined,
  force: boolean
): boolean {
  if (force || !existingUpdatedAt) return true;
  const s = Date.parse(session.updated_at);
  const n = Date.parse(existingUpdatedAt);
  if (!Number.isFinite(s)) return true;
  if (!Number.isFinite(n)) return true;
  return s > n;
}

export function formatEpisodicNoteBody(session: SessionRecord, runs: RunRecord[]): string {
  const header = [
    `<!-- csagent episodic ingest; session=${session.id} -->`,
    "",
    formatSessionRunsMarkdown(session, runs).trimEnd(),
  ].join("\n");
  return header.endsWith("\n") ? header : `${header}\n`;
}

export async function ingestRecentSessions(
  dir: string,
  opts: SessionIngestOptions = {}
): Promise<SessionIngestResult> {
  const cfg = loadConfig(dir);
  const windowMs = Math.max(1, opts.windowHours ?? 168) * 3600_000;
  const cutoff = Date.now() - windowMs;
  const limit = Math.max(1, opts.limit ?? 50);
  const force = opts.force === true;

  const store = createStore(dir, cfg.stateDir);
  const memory = createMemoryStore(dir, cfg.stateDir);
  const names: string[] = [];
  let ingested = 0;
  let skipped = 0;
  let updated = 0;

  try {
    const sessions = await store.listSessions(500);
    const recent = sessions
      .filter((s) => {
        const t = Date.parse(s.updated_at);
        return Number.isFinite(t) && t >= cutoff;
      })
      .slice(0, limit);

    for (const session of recent) {
      const runs = await store.listRuns(session.id);
      if (runs.length === 0) {
        skipped++;
        continue;
      }
      if (shouldSkipEpisodicIngest(session, runs)) {
        skipped++;
        continue;
      }
      const name = episodicNoteName(session.id);
      const existing = await memory.getNote(name);
      if (!sessionNeedsIngest(session, existing?.updated_at, force)) {
        skipped++;
        continue;
      }
      const hadNote = Boolean(existing);
      const body = formatEpisodicNoteBody(session, runs);
      await memory.upsertNote({
        name,
        wing: EPISODIC_WING,
        title: session.title?.trim() || `Session ${session.id}`,
        body,
      });
      names.push(name);
      if (hadNote) updated++;
      else ingested++;
    }
  } finally {
    await store.close();
    await memory.close();
  }

  return { ingested, skipped, updated, names };
}

/** Test hook: ingest one session through an injected memory store. */
export async function ingestSessionRecord(
  memory: IMemoryStore,
  session: SessionRecord,
  runs: RunRecord[],
  opts: { force?: boolean } = {}
): Promise<"ingested" | "updated" | "skipped"> {
  if (runs.length === 0) return "skipped";
  if (shouldSkipEpisodicIngest(session, runs)) return "skipped";
  const name = episodicNoteName(session.id);
  const existing = await memory.getNote(name);
  if (!sessionNeedsIngest(session, existing?.updated_at, opts.force === true)) {
    return "skipped";
  }
  await memory.upsertNote({
    name,
    wing: EPISODIC_WING,
    title: session.title?.trim() || `Session ${session.id}`,
    body: formatEpisodicNoteBody(session, runs),
  });
  return existing ? "updated" : "ingested";
}
