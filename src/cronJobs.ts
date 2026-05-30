/**
 * Cron job definitions under .agent/cron.jobs.json (issue 038).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { CronError, parseCronExpression, validateCronExpression, cronMinuteKey } from "./cronSchedule.js";

export const CRON_JOBS_FILE = "cron.jobs.json";
export const CRON_STATE_FILE = "cron.state.json";

export interface CronJobNotify {
  chatId: string;
  webhookUrl?: string;
  secretEnv?: string;
}

export interface CronJob {
  id: string;
  cron: string;
  prompt: string;
  cwd?: string;
  sessionId?: string;
  skills?: string[];
  enabled?: boolean;
  yesIUnderstand?: boolean;
  /** Optional gateway webhook notify on completion (issue 038 P2). */
  notify?: CronJobNotify;
}

export interface CronJobsFile {
  version: number;
  jobs: CronJob[];
}

export interface CronStateFile {
  version: number;
  /** job id → last executed minute key (local). */
  lastRun: Record<string, string>;
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
  if (!id || !/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new CronJobsError(`jobs[${index}].id must be a non-empty slug`);
  }
  if (!cron) throw new CronJobsError(`jobs[${index}].cron is required`);
  if (!prompt) throw new CronJobsError(`jobs[${index}].prompt is required`);
  try {
    validateCronExpression(cron);
  } catch (e) {
    throw new CronJobsError(`jobs[${index}].cron: ${e instanceof CronError ? e.message : String(e)}`);
  }
  const job: CronJob = { id, cron, prompt };
  if (typeof o.cwd === "string" && o.cwd.trim()) job.cwd = o.cwd.trim();
  if (typeof o.sessionId === "string" && o.sessionId.trim()) job.sessionId = o.sessionId.trim();
  if (Array.isArray(o.skills)) {
    job.skills = o.skills
      .filter((s): s is string => typeof s === "string" && s.trim() !== "")
      .map((s) => s.trim());
  }
  if (o.enabled === false) job.enabled = false;
  if (o.yesIUnderstand === true) job.yesIUnderstand = true;
  if (o.notify && typeof o.notify === "object" && !Array.isArray(o.notify)) {
    const n = o.notify as Record<string, unknown>;
    const chatId = typeof n.chatId === "string" ? n.chatId.trim() : "";
    if (chatId) {
      job.notify = { chatId };
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
    return {
      version: 1,
      lastRun: parsed.lastRun && typeof parsed.lastRun === "object" ? { ...parsed.lastRun } : {},
    };
  } catch {
    return { version: 1, lastRun: {} };
  }
}

export function saveCronState(dir: string, state: CronStateFile): void {
  const cfg = loadConfig(dir);
  const root = resolve(dir, cfg.stateDir);
  mkdirSync(root, { recursive: true });
  writeFileSync(statePath(dir), JSON.stringify(state, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
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

export function isJobDue(job: CronJob, at: Date, state: CronStateFile): boolean {
  if (!cronJobEnabled(job)) return false;
  const cron = parseCronExpression(job.cron);
  if (!cron.matches(at)) return false;
  const key = cronMinuteKey(at);
  return state.lastRun[job.id] !== key;
}

export { jobsPath as cronJobsPath, statePath as cronStatePath };
