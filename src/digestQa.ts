/**
 * Automated QA for TParser daily digest (personal ops).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import {
  loadCronJobs,
  loadCronState,
  saveCronState,
  type CronJobLastResult,
} from "./cronJobs.js";
import { TPARSE_DAILY_TOPICS } from "./tparserTopics.js";

export const DEFAULT_DIGEST_JOB_ID = "tparser-daily-digest";

/** Daily digest should have run within this window. */
export const DIGEST_MAX_AGE_HOURS = 26;

/** Warn if digest finished faster (likely broken pipeline). */
export const DIGEST_MIN_DURATION_MS = 30_000;

/** Warn if digest took longer. */
export const DIGEST_MAX_DURATION_MS = 60 * 60_000;

/** Minimum topic delegates that must succeed. */
export const DIGEST_MIN_TOPIC_OK = 4;

export interface DigestQaCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DigestQaReport {
  jobId: string;
  ok: boolean;
  checks: DigestQaCheck[];
}

export function digestOutputPath(dir: string, jobId: string): string {
  const cfg = loadConfig(dir);
  return resolve(dir, cfg.stateDir, `cron.last-digest.${jobId}.txt`);
}

export function saveDigestOutput(dir: string, jobId: string, output: string): void {
  const path = digestOutputPath(dir, jobId);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, output.trim() + "\n", { encoding: "utf8", mode: 0o600 });
}

export function loadDigestOutput(dir: string, jobId: string): string | null {
  const path = digestOutputPath(dir, jobId);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").trim() || null;
}

function check(name: string, ok: boolean, detail: string): DigestQaCheck {
  return { name, ok, detail };
}

function hoursSince(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 3_600_000;
}

function countTmeLinks(text: string): number {
  const matches = text.match(/t\.me\/[^\s)]+/gi);
  return matches?.length ?? 0;
}

function isEmptyDigest(text: string): boolean {
  return /релевантных постов не было/i.test(text) || /нет релевантных постов/i.test(text);
}

export function evaluateDigestQa(
  dir: string,
  jobId: string = DEFAULT_DIGEST_JOB_ID,
  now: Date = new Date()
): DigestQaReport {
  const checks: DigestQaCheck[] = [];
  let jobFound = false;

  try {
    const jobs = loadCronJobs(dir);
    jobFound = jobs.some((j) => j.id === jobId && j.topicDelegates);
    if (!jobFound) {
      checks.push(check("job config", false, `job '${jobId}' missing or not topicDelegates`));
    } else {
      checks.push(check("job config", true, `${jobId} · topicDelegates`));
    }
  } catch (e) {
    checks.push(check("job config", false, e instanceof Error ? e.message : String(e)));
  }

  const state = loadCronState(dir);
  const last: CronJobLastResult | undefined = state.lastResult?.[jobId];

  if (!last) {
    checks.push(check("last run", false, "no lastResult in cron.state.json"));
    return { jobId, ok: false, checks };
  }

  checks.push(check("run status", last.ok, last.ok ? "OK" : `FAIL — ${last.message.slice(0, 120)}`));

  const ageH = hoursSince(last.at);
  checks.push(
    check(
      "freshness",
      ageH <= DIGEST_MAX_AGE_HOURS,
      `${ageH.toFixed(1)}h ago (max ${DIGEST_MAX_AGE_HOURS}h)`
    )
  );

  if (last.durationMs > 0) {
    const durOk = last.durationMs >= DIGEST_MIN_DURATION_MS && last.durationMs <= DIGEST_MAX_DURATION_MS;
    const durMin = Math.round(last.durationMs / 60_000);
    checks.push(
      check(
        "duration",
        durOk,
        `${durMin}m (${last.durationMs}ms; expected ${DIGEST_MIN_DURATION_MS / 1000}s–${DIGEST_MAX_DURATION_MS / 60_000}m)`
      )
    );
  } else {
    checks.push(check("duration", false, "durationMs missing"));
  }

  if (last.topicTotal != null && last.topicOk != null) {
    checks.push(
      check(
        "topics",
        last.topicOk >= DIGEST_MIN_TOPIC_OK,
        `${last.topicOk}/${last.topicTotal} ok (min ${DIGEST_MIN_TOPIC_OK}/${TPARSE_DAILY_TOPICS.length})`
      )
    );
    if (last.topics?.length) {
      const failed = last.topics.filter((t) => !t.ok).map((t) => t.id);
      if (failed.length) {
        checks.push(check("topic failures", false, failed.join(", ")));
      }
    }
  } else {
    checks.push(check("topics", false, "topic stats missing from lastResult"));
  }

  const body = loadDigestOutput(dir, jobId);
  if (!body) {
    checks.push(check("digest body", false, `missing ${digestOutputPath(dir, jobId)}`));
  } else {
    const empty = isEmptyDigest(body);
    const hasHeader = /📬|TParser/i.test(body);
    checks.push(
      check("digest header", hasHeader || empty, hasHeader ? "📬/TParser present" : "no header (non-empty digest)")
    );

    const len = body.length;
    const lenOk = empty ? len >= 20 && len <= 500 : len >= 100 && len <= 4500;
    checks.push(check("digest length", lenOk, `${len} chars`));

    const links = countTmeLinks(body);
    if (empty) {
      checks.push(check("tg links", true, "skipped (empty day)"));
    } else {
      checks.push(check("tg links", links >= 1, `${links} t.me link(s)`));
    }

    const topicHeaders = TPARSE_DAILY_TOPICS.filter((t) =>
      new RegExp(t.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(body)
    );
    if (empty) {
      checks.push(check("topic sections", true, "skipped (empty day)"));
    } else {
      checks.push(
        check(
          "topic sections",
          topicHeaders.length >= 3,
          `${topicHeaders.length}/${TPARSE_DAILY_TOPICS.length} topic headings found`
        )
      );
    }
  }

  void now;
  const ok = checks.every((c) => c.ok);
  return { jobId, ok, checks };
}

export function formatDigestQaReport(report: DigestQaReport): string {
  const lines = [`digest QA · ${report.jobId} · ${report.ok ? "PASS" : "FAIL"}`, ""];
  for (const c of report.checks) {
    lines.push(`${c.ok ? "OK" : "FAIL"} ${c.name}: ${c.detail}`);
  }
  return lines.join("\n");
}

export interface DigestQaAlertOptions {
  /** Morning re-check (launchd 08:00 safety net). */
  morning?: boolean;
}

/** Short Telegram alert when automated QA fails. */
export function formatDigestQaAlert(report: DigestQaReport, opts: DigestQaAlertOptions = {}): string {
  const failed = report.checks.filter((c) => !c.ok);
  const head = opts.morning
    ? `🌅 [cron:${report.jobId}] morning QA FAIL`
    : `⚠️ [cron:${report.jobId}] QA FAIL`;
  const lines = [
    head,
    "",
    ...failed.map((c) => `FAIL ${c.name}: ${c.detail}`),
    "",
    "Проверь: csagent cron qa · deploy/DIGEST-QA.md",
  ];
  return lines.join("\n");
}

/** Snippet from last saved digest for Telegram follow-up context (H2). */
export function loadLastDigestContext(
  dir: string,
  jobId: string = DEFAULT_DIGEST_JOB_ID,
  maxChars = 1500
): string {
  const body = loadDigestOutput(dir, jobId);
  if (!body) return "";
  const snippet = body.length > maxChars ? `${body.slice(0, maxChars)}…` : body;
  return `[digest-context] Last daily digest (snippet):\n${snippet}\n\n`;
}

export function saveDigestQaResult(dir: string, jobId: string, report: DigestQaReport): void {
  const state = loadCronState(dir);
  const prev = state.lastResult?.[jobId];
  if (!prev) return;
  state.lastResult = {
    ...state.lastResult,
    [jobId]: {
      ...prev,
      qaOk: report.ok,
      qaFailedChecks: report.checks.filter((c) => !c.ok).map((c) => c.name),
    },
  };
  saveCronState(dir, state);
}
