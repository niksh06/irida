/**
 * Cron job definitions under .agent/cron.jobs.json (issue 038).
 */
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { writeFileAtomic } from "./util.js";
import { CronError, parseCronExpression, validateCronExpression, cronMinuteKey } from "./cronSchedule.js";

export const CRON_JOBS_FILE = "cron.jobs.json";
export const CRON_STATE_FILE = "cron.state.json";

export const CRON_BUILTIN_HANDLERS = ["memory-audit", "session-export", "session-ingest"] as const;
export type CronBuiltinHandler = (typeof CRON_BUILTIN_HANDLERS)[number];

export interface CronJobNotify {
  chatId: string;
  /** Direct Telegram sendMessage (no webhook agent turn). */
  telegram?: boolean;
  tokenEnv?: string;
  webhookUrl?: string;
  secretEnv?: string;
}

export interface CronJob {
  id: string;
  cron: string;
  /** Inline prompt text (optional if promptFile is set). */
  prompt?: string;
  /** Path to prompt file relative to cwd, config dir, or CSAGENT_ROOT. */
  promptFile?: string;
  cwd?: string;
  sessionId?: string;
  skills?: string[];
  enabled?: boolean;
  yesIUnderstand?: boolean;
  /** Optional gateway webhook notify on completion (issue 038 P2). */
  notify?: CronJobNotify;
  /** Prepend recent memory_facts for this subject (e.g. seen_post). */
  memoryFactsSubject?: string;
  memoryFactsLimit?: number;
  /** Run TParser-style topic delegates (5) + synthesizer instead of single prompt. */
  topicDelegates?: boolean;
  topicPromptFile?: string;
  synthesizePromptFile?: string;
  /** Hours for daily window (default 24). */
  topicWindowHours?: number;
  /** Built-in CLI handler (no SDK prompt). */
  builtin?: CronBuiltinHandler;
  /**
   * Lookback window (minutes) for catching a missed slot, e.g. after machine
   * sleep. Default CRON_DUE_GRACE_MINUTES; daily jobs may want 360-720.
   */
  graceMinutes?: number;
  /**
   * Missed-slot policy (A3): "once" (default) — one catch-up run within grace;
   * "skip" — stale slots are dropped (briefings that must not arrive late).
   */
  catchUp?: "once" | "skip";
  /**
   * Cheap pre-script (A1): runs before the SDK; last stdout line
   * {"wakeAgent": false} skips the run entirely (no tokens, no notify).
   * Fail-open: gate errors never block the job. Manual `cron run` bypasses.
   */
  gateScript?: string;
  /** Deterministic shell job without SDK (A2): stdout becomes the notify text. */
  script?: string;
}

export interface CronJobsFile {
  version: number;
  jobs: CronJob[];
}

export interface CronJobLastResult {
  at: string;
  ok: boolean;
  durationMs: number;
  message: string;
  topicOk?: number;
  topicTotal?: number;
  topics?: Array<{ id: string; title: string; ok: boolean }>;
  /** Set after automated digest QA (topicDelegates jobs). */
  qaOk?: boolean;
  qaFailedChecks?: string[];
}

export interface CronStateFile {
  version: number;
  /** job id → last executed minute key (local). */
  lastRun: Record<string, string>;
  /** job id → last run outcome (ops post-mortem / /status). */
  lastResult?: Record<string, CronJobLastResult>;
}

export class CronJobsError extends Error {}

function jobsPath(dir: string): string {
  const cfg = loadConfig(dir);
  return resolve(dir, cfg.stateDir, CRON_JOBS_FILE);
}

function statePath(dir: string): string {
  const cfg = loadConfig(dir);
  return resolve(dir, cfg.stateDir, CRON_STATE_FILE);
}

function validateJob(raw: unknown, index: number): CronJob {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CronJobsError(`jobs[${index}] must be an object`);
  }
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const cron = typeof o.cron === "string" ? o.cron.trim() : "";
  const prompt = typeof o.prompt === "string" ? o.prompt.trim() : "";
  const promptFile = typeof o.promptFile === "string" ? o.promptFile.trim() : "";
  const builtinRaw = typeof o.builtin === "string" ? o.builtin.trim() : "";
  if (!id || !/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new CronJobsError(`jobs[${index}].id must be a non-empty slug`);
  }
  if (!cron) throw new CronJobsError(`jobs[${index}].cron is required`);
  const topicDelegates = o.topicDelegates === true;
  const scriptRaw = typeof o.script === "string" ? o.script.trim() : "";
  if (scriptRaw && (prompt || promptFile || builtinRaw || topicDelegates)) {
    throw new CronJobsError(
      `jobs[${index}] script is exclusive with prompt/promptFile/builtin/topicDelegates`
    );
  }
  if (topicDelegates) {
    const tp = typeof o.topicPromptFile === "string" ? o.topicPromptFile.trim() : "";
    const sp = typeof o.synthesizePromptFile === "string" ? o.synthesizePromptFile.trim() : "";
    if (!tp || !sp) {
      throw new CronJobsError(`jobs[${index}] topicDelegates requires topicPromptFile and synthesizePromptFile`);
    }
  } else if (builtinRaw) {
    if (!(CRON_BUILTIN_HANDLERS as readonly string[]).includes(builtinRaw)) {
      throw new CronJobsError(
        `jobs[${index}].builtin must be one of: ${CRON_BUILTIN_HANDLERS.join(", ")}`
      );
    }
  } else if (!prompt && !promptFile && !scriptRaw) {
    throw new CronJobsError(`jobs[${index}] requires prompt, promptFile, builtin, or script`);
  }
  if (prompt && promptFile) {
    throw new CronJobsError(`jobs[${index}] cannot set both prompt and promptFile`);
  }
  try {
    validateCronExpression(cron);
  } catch (e) {
    throw new CronJobsError(`jobs[${index}].cron: ${e instanceof CronError ? e.message : String(e)}`);
  }
  const job: CronJob = { id, cron };
  if (prompt) job.prompt = prompt;
  if (promptFile) job.promptFile = promptFile;
  if (typeof o.cwd === "string" && o.cwd.trim()) job.cwd = o.cwd.trim();
  if (typeof o.sessionId === "string" && o.sessionId.trim()) job.sessionId = o.sessionId.trim();
  if (Array.isArray(o.skills)) {
    job.skills = o.skills
      .filter((s): s is string => typeof s === "string" && s.trim() !== "")
      .map((s) => s.trim());
  }
  if (o.enabled === false) job.enabled = false;
  if (o.yesIUnderstand === true) job.yesIUnderstand = true;
  if (typeof o.memoryFactsSubject === "string" && o.memoryFactsSubject.trim()) {
    job.memoryFactsSubject = o.memoryFactsSubject.trim();
  }
  if (typeof o.memoryFactsLimit === "number" && o.memoryFactsLimit > 0) {
    job.memoryFactsLimit = Math.min(o.memoryFactsLimit, 500);
  }
  if (topicDelegates) {
    job.topicDelegates = true;
    job.topicPromptFile = (o.topicPromptFile as string).trim();
    job.synthesizePromptFile = (o.synthesizePromptFile as string).trim();
  }
  if (typeof o.topicWindowHours === "number" && o.topicWindowHours > 0) {
    job.topicWindowHours = Math.min(o.topicWindowHours, 72);
  }
  if (typeof o.graceMinutes === "number" && o.graceMinutes > 0) {
    job.graceMinutes = Math.min(Math.floor(o.graceMinutes), 24 * 60);
  }
  if (o.catchUp !== undefined) {
    if (o.catchUp !== "once" && o.catchUp !== "skip") {
      throw new CronJobsError(`jobs[${index}].catchUp must be "once" or "skip"`);
    }
    job.catchUp = o.catchUp;
  }
  if (typeof o.gateScript === "string" && o.gateScript.trim()) {
    job.gateScript = o.gateScript.trim();
  }
  if (scriptRaw) job.script = scriptRaw;
  if (builtinRaw) job.builtin = builtinRaw as CronBuiltinHandler;
  if (o.notify && typeof o.notify === "object" && !Array.isArray(o.notify)) {
    const n = o.notify as Record<string, unknown>;
    const chatId = typeof n.chatId === "string" ? n.chatId.trim() : "";
    if (chatId) {
      job.notify = { chatId };
      if (n.telegram === true) job.notify.telegram = true;
      if (typeof n.tokenEnv === "string" && n.tokenEnv.trim()) job.notify.tokenEnv = n.tokenEnv.trim();
      if (typeof n.webhookUrl === "string" && n.webhookUrl.trim()) job.notify.webhookUrl = n.webhookUrl.trim();
      if (typeof n.secretEnv === "string" && n.secretEnv.trim()) job.notify.secretEnv = n.secretEnv.trim();
    }
  }
  return job;
}

export function loadCronJobs(dir: string = process.cwd()): CronJob[] {
  const path = jobsPath(dir);
  if (!existsSync(path)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new CronJobsError(`cannot parse ${CRON_JOBS_FILE}: ${(e as Error).message}`);
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CronJobsError(`${CRON_JOBS_FILE} must be a JSON object`);
  }
  const jobsRaw = (parsed as CronJobsFile).jobs;
  if (!Array.isArray(jobsRaw)) throw new CronJobsError(`${CRON_JOBS_FILE} must contain jobs array`);
  const ids = new Set<string>();
  const jobs: CronJob[] = [];
  jobsRaw.forEach((j, i) => {
    const job = validateJob(j, i);
    if (ids.has(job.id)) throw new CronJobsError(`duplicate job id '${job.id}'`);
    ids.add(job.id);
    jobs.push(job);
  });
  return jobs;
}

export function loadCronState(dir: string = process.cwd()): CronStateFile {
  const path = statePath(dir);
  if (!existsSync(path)) return { version: 1, lastRun: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CronStateFile>;
    const lastResult =
      parsed.lastResult && typeof parsed.lastResult === "object" ? { ...parsed.lastResult } : {};
    return {
      version: 1,
      lastRun: parsed.lastRun && typeof parsed.lastRun === "object" ? { ...parsed.lastRun } : {},
      lastResult: Object.keys(lastResult).length ? lastResult : undefined,
    };
  } catch {
    return { version: 1, lastRun: {} };
  }
}

export function saveCronState(dir: string, state: CronStateFile): void {
  const cfg = loadConfig(dir);
  const root = resolve(dir, cfg.stateDir);
  mkdirSync(root, { recursive: true });
  writeFileAtomic(statePath(dir), JSON.stringify(state, null, 2) + "\n");
}

export function validateCronJobsFile(dir: string = process.cwd()): string[] {
  try {
    loadCronJobs(dir);
    return [];
  } catch (e) {
    return [e instanceof CronJobsError ? e.message : String(e)];
  }
}

export function cronJobEnabled(job: CronJob): boolean {
  return job.enabled !== false;
}

function parseCronMinuteKey(key: string): Date | null {
  const m = key.trim().match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
}

/** launchd StartInterval (300s) rarely hits minute 0 — look back for a due slot. */
export const CRON_DUE_GRACE_MINUTES = 10;

export function findDueCronMinute(
  job: CronJob,
  at: Date,
  state: CronStateFile,
  graceMinutes?: number
): Date | null {
  if (!cronJobEnabled(job)) return null;
  // catchUp "skip": stale slots are dropped — never look back beyond the
  // standard tick window even when graceMinutes is large (A3).
  const jobGrace =
    job.catchUp === "skip"
      ? CRON_DUE_GRACE_MINUTES
      : job.graceMinutes ?? CRON_DUE_GRACE_MINUTES;
  const grace = graceMinutes ?? jobGrace;
  const cron = parseCronExpression(job.cron);
  const tick = new Date(at);
  tick.setSeconds(0, 0);
  const lastRan = parseCronMinuteKey(state.lastRun[job.id] ?? "");

  // Oldest due slot first: a tick at 10:07 for "*/5" must run the missed 10:00
  // slot, not jump to 10:05 and skip 10:00 forever.
  for (let m = grace; m >= 0; m--) {
    const probe = new Date(tick.getTime() - m * 60_000);
    probe.setSeconds(0, 0);
    if (!cron.matches(probe)) continue;
    if (lastRan && probe.getTime() <= lastRan.getTime()) continue;
    return probe;
  }
  return null;
}

export function isJobDue(job: CronJob, at: Date, state: CronStateFile): boolean {
  return findDueCronMinute(job, at, state) !== null;
}

export { jobsPath as cronJobsPath, statePath as cronStatePath };

export function saveCronJobs(dir: string, jobs: CronJob[]): void {
  const cfg = loadConfig(dir);
  const root = resolve(dir, cfg.stateDir);
  mkdirSync(root, { recursive: true });
  writeFileAtomic(jobsPath(dir), JSON.stringify({ version: 1, jobs }, null, 2) + "\n");
}
