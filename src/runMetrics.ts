/**
 * Aggregate run metrics from logs/runs.jsonl (I-33) — no DB migration needed.
 * Powers `/status` and `gateway status` with latency/error/token numbers.
 */
import { existsSync, readFileSync } from "node:fs";
import { runLogPath, type RunLogEntry } from "./runLog.js";
import { estimateCostUsd, formatUsd } from "./pricing.js";

export interface RunMetrics {
  runs: number;
  errors: number;
  errorRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Estimated USD over priced runs (I-116); null when no run had a known model. */
  costUsd: number | null;
}

export interface RunMetricsFilter {
  /** Exclude entries with is_test=true (I-68). */
  prodOnly?: boolean;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

export function parseRunLogLines(body: string): RunLogEntry[] {
  const out: RunLogEntry[] = [];
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as RunLogEntry);
    } catch {
      /* torn line (rotation/crash) — skip */
    }
  }
  return out;
}

export function computeRunMetrics(
  entries: RunLogEntry[],
  sinceMs: number,
  filter?: RunMetricsFilter
): RunMetrics {
  let recent = entries.filter((e) => {
    const t = Date.parse(e.ts);
    return Number.isFinite(t) && t >= sinceMs && e.status !== "injected";
  });
  if (filter?.prodOnly) {
    recent = recent.filter((e) => e.is_test !== true);
  }
  const durations = recent
    .map((e) => e.duration_ms)
    .filter((d): d is number => typeof d === "number" && d >= 0)
    .sort((a, b) => a - b);
  const errors = recent.filter((e) => e.status === "error" || e.error_kind != null).length;
  let costUsd: number | null = null;
  for (const e of recent) {
    const c = estimateCostUsd(
      {
        inputTokens: e.input_tokens,
        outputTokens: e.output_tokens,
        cacheReadTokens: e.cache_read_tokens,
        cacheCreationTokens: e.cache_creation_tokens,
      },
      e.model
    );
    if (c != null) costUsd = (costUsd ?? 0) + c;
  }
  return {
    runs: recent.length,
    errors,
    errorRate: recent.length ? errors / recent.length : 0,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    inputTokens: recent.reduce((n, e) => n + (e.input_tokens ?? 0), 0),
    outputTokens: recent.reduce((n, e) => n + (e.output_tokens ?? 0), 0),
    cacheReadTokens: recent.reduce((n, e) => n + (e.cache_read_tokens ?? 0), 0),
    cacheCreationTokens: recent.reduce((n, e) => n + (e.cache_creation_tokens ?? 0), 0),
    costUsd,
  };
}

/** Read current run log + one rotation back as parsed entries. */
export function loadRunLogEntries(dir: string, stateDir: string): RunLogEntry[] {
  const path = runLogPath(dir, stateDir);
  let body = "";
  if (existsSync(`${path}.1`)) body += readFileSync(`${path}.1`, "utf8");
  if (existsSync(path)) body += readFileSync(path, "utf8");
  return parseRunLogLines(body);
}

/** Read current log + one rotation back. */
export function loadRunMetrics(
  dir: string,
  stateDir: string,
  windowHours = 24,
  filter?: RunMetricsFilter
): RunMetrics {
  return computeRunMetrics(loadRunLogEntries(dir, stateDir), Date.now() - windowHours * 3600_000, filter);
}

/**
 * Count recent runs whose `error_kind` is in `kinds` (I-121 engine-streak detector).
 * Surfaces an auth/403 streak (e.g. the claude-agent account rate cap) that
 * otherwise only lands in error.log. Excludes injected/test entries like the metrics.
 */
export function countRecentErrorKinds(
  entries: RunLogEntry[],
  sinceMs: number,
  kinds: string[],
  filter?: RunMetricsFilter
): number {
  const set = new Set(kinds);
  let recent = entries.filter((e) => {
    const t = Date.parse(e.ts);
    return Number.isFinite(t) && t >= sinceMs && e.status !== "injected";
  });
  if (filter?.prodOnly) recent = recent.filter((e) => e.is_test !== true);
  return recent.filter((e) => e.error_kind != null && set.has(e.error_kind)).length;
}

export interface SessionUsage {
  sessionId: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number | null;
}

/**
 * Aggregate usage for one session across all its runs (I-116). Keyed by
 * `session_id` in `runs.jsonl`, so the total **survives resume** — a session
 * resumed in a fresh process still sums its earlier turns from the persisted log.
 */
export function sessionUsage(entries: RunLogEntry[], sessionId: string): SessionUsage {
  const mine = entries.filter((e) => e.session_id === sessionId && e.status !== "injected");
  let costUsd: number | null = null;
  for (const e of mine) {
    const c = estimateCostUsd(
      {
        inputTokens: e.input_tokens,
        outputTokens: e.output_tokens,
        cacheReadTokens: e.cache_read_tokens,
        cacheCreationTokens: e.cache_creation_tokens,
      },
      e.model
    );
    if (c != null) costUsd = (costUsd ?? 0) + c;
  }
  return {
    sessionId,
    runs: mine.length,
    inputTokens: mine.reduce((n, e) => n + (e.input_tokens ?? 0), 0),
    outputTokens: mine.reduce((n, e) => n + (e.output_tokens ?? 0), 0),
    cacheReadTokens: mine.reduce((n, e) => n + (e.cache_read_tokens ?? 0), 0),
    cacheCreationTokens: mine.reduce((n, e) => n + (e.cache_creation_tokens ?? 0), 0),
    costUsd,
  };
}

export function loadSessionUsage(dir: string, stateDir: string, sessionId: string): SessionUsage {
  return sessionUsage(loadRunLogEntries(dir, stateDir), sessionId);
}

export function formatSessionUsage(u: SessionUsage): string {
  const cost = u.costUsd != null ? ` · ${formatUsd(u.costUsd)} est` : "";
  return `session ${u.sessionId}: ${u.runs} turn(s) · tokens in/out ${u.inputTokens}/${u.outputTokens} · cache r/w ${u.cacheReadTokens}/${u.cacheCreationTokens}${cost}`;
}

export function formatRunMetrics(
  m: RunMetrics,
  windowHours = 24,
  filter?: RunMetricsFilter
): string {
  if (m.runs === 0) {
    const scope = filter?.prodOnly ? "prod " : "";
    return `no ${scope}runs in last ${windowHours}h`;
  }
  const fmtMs = (v: number | null) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`);
  const tokens =
    m.inputTokens || m.outputTokens ? ` · tokens in/out ${m.inputTokens}/${m.outputTokens}` : "";
  const cache =
    m.cacheReadTokens || m.cacheCreationTokens
      ? ` · cache r/w ${m.cacheReadTokens}/${m.cacheCreationTokens}`
      : "";
  const cost = m.costUsd != null ? ` · ${formatUsd(m.costUsd)} est` : "";
  const scope = filter?.prodOnly ? " · prod only" : "";
  return `${m.runs} run(s) · err ${(m.errorRate * 100).toFixed(0)}% · p50 ${fmtMs(m.p50Ms)} · p95 ${fmtMs(m.p95Ms)}${tokens}${cache}${cost}${scope}`;
}
