/**
 * Structured run log (I-19, roadmap R2-3): one JSONL line per recorded run.
 * Ops tail/grep/jq without opening sqlite/PG; previews stay in the store only
 * (no prompt/result text here — nothing to redact).
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { RunRecord } from "./store.js";
import { iridaRunLog } from "./env.js";

export const RUN_LOG_FILE = "logs/runs.jsonl";
const ROTATE_BYTES = 5 * 1024 * 1024;

export interface RunLogEntry {
  ts: string;
  run_id: string;
  session_id: string;
  sdk_run_id: string | null;
  status: string;
  error_kind: string | null;
  duration_ms: number | null;
  model: string;
  runtime: string;
  cwd: string;
  input_tokens: number | null;
  output_tokens: number | null;
  /** Entry channel (I-68). */
  channel?: string | null;
  cron_job?: string | null;
  is_test?: boolean;
}

export function runLogPath(dir: string, stateDir: string): string {
  return resolve(dir, stateDir, RUN_LOG_FILE);
}

export function runLogEnabled(): boolean {
  return iridaRunLog() !== "0";
}

export function runRecordToLogEntry(r: RunRecord): RunLogEntry {
  const started = Date.parse(r.started_at);
  const finished = r.finished_at ? Date.parse(r.finished_at) : NaN;
  const duration =
    Number.isFinite(started) && Number.isFinite(finished) ? Math.max(0, finished - started) : null;
  return {
    ts: r.finished_at ?? r.started_at,
    run_id: r.id,
    session_id: r.session_id,
    sdk_run_id: r.sdk_run_id,
    status: r.status,
    error_kind: r.error_kind ?? null,
    duration_ms: duration,
    model: r.model,
    runtime: r.runtime,
    cwd: r.cwd,
    input_tokens: r.input_tokens ?? null,
    output_tokens: r.output_tokens ?? null,
    channel: r.channel ?? null,
    cron_job: r.cron_job ?? null,
    is_test: r.is_test === true,
  };
}

function rotateIfNeeded(path: string): void {
  try {
    if (statSync(path).size >= ROTATE_BYTES) {
      renameSync(path, `${path}.1`);
    }
  } catch {
    /* no file yet */
  }
}

/** Append one entry; diagnostics must never break the run path. */
export function appendRunLog(dir: string, stateDir: string, record: RunRecord): void {
  if (!runLogEnabled()) return;
  try {
    const path = runLogPath(dir, stateDir);
    mkdirSync(dirname(path), { recursive: true });
    rotateIfNeeded(path);
    appendFileSync(path, JSON.stringify(runRecordToLogEntry(record)) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    /* best-effort */
  }
}
