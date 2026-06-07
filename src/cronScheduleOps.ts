/**
 * User cron scheduling — validated add/remove/propose/approve (chat + slash).
 */
import { loadCronJobs, saveCronJobs, type CronJob } from "./cronJobs.js";
import { validateCronExpression, formatCronWhen, nextCronRun } from "./cronSchedule.js";
import { validateCronJobPrompt } from "./cronPromptGuard.js";
import { CronJobsError } from "./cronJobs.js";
import {
  loadCronSchedulePending,
  saveCronSchedulePending,
  newScheduleCode,
  type CronSchedulePendingEntry,
} from "./cronSchedulePending.js";

export const USER_CRON_JOB_PREFIX = "user-";
export const MAX_USER_CRON_JOBS = 10;

export const PROTECTED_CRON_JOB_IDS = new Set([
  "tparser-daily-digest",
  "memory-curator-weekly",
  "memory-audit-weekly",
  "happyin-kb-weekly",
  "tparser-bi-hourly-digest",
]);

export interface UserCronDraft {
  id: string;
  cron: string;
  prompt: string;
  skills?: string[];
  cwd?: string;
}

export function normalizeUserJobId(id: string): string {
  const slug = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (!slug) throw new CronJobsError("job id required");
  if (PROTECTED_CRON_JOB_IDS.has(slug)) {
    throw new CronJobsError(`job id '${slug}' is reserved`);
  }
  return slug.startsWith(USER_CRON_JOB_PREFIX) ? slug : `${USER_CRON_JOB_PREFIX}${slug}`;
}

export function isUserCronJob(job: CronJob): boolean {
  return job.id.startsWith(USER_CRON_JOB_PREFIX);
}

export function countUserCronJobs(jobs: CronJob[]): number {
  return jobs.filter(isUserCronJob).length;
}

export function validateUserCronDraft(
  draft: UserCronDraft,
  dir: string,
  existingJobs: CronJob[]
): string[] {
  const errs: string[] = [];
  let id: string;
  try {
    id = normalizeUserJobId(draft.id);
  } catch (e) {
    return [e instanceof CronJobsError ? e.message : String(e)];
  }
  if (existingJobs.some((j) => j.id === id)) {
    errs.push(`job id '${id}' already exists`);
  }
  if (countUserCronJobs(existingJobs) >= MAX_USER_CRON_JOBS) {
    errs.push(`max ${MAX_USER_CRON_JOBS} user jobs reached`);
  }
  const cron = draft.cron.trim();
  if (!cron) errs.push("cron expression required");
  else {
    try {
      validateCronExpression(cron);
    } catch (e) {
      errs.push(e instanceof Error ? e.message : String(e));
    }
  }
  const prompt = draft.prompt.trim();
  if (!prompt) errs.push("prompt required");
  if (prompt.length > 4000) errs.push("prompt too long (max 4000 chars)");

  const job: CronJob = {
    id,
    cron,
    prompt,
    skills: draft.skills?.length ? draft.skills : undefined,
    cwd: draft.cwd?.trim() || undefined,
  };
  errs.push(...validateCronJobPrompt(job, dir));
  return errs;
}

export function buildUserCronJob(
  draft: UserCronDraft,
  notify: { chatId: string; telegram?: boolean }
): CronJob {
  return {
    id: normalizeUserJobId(draft.id),
    cron: draft.cron.trim(),
    prompt: draft.prompt.trim(),
    skills: draft.skills?.length ? draft.skills : undefined,
    cwd: draft.cwd?.trim() || undefined,
    notify: { chatId: notify.chatId, telegram: notify.telegram ?? true },
  };
}

export function formatCronJobLine(job: CronJob): string {
  const next = nextCronRun(job.cron);
  const nextStr = next ? formatCronWhen(next) : "—";
  const on = job.enabled === false ? "off" : "on";
  const prompt = (job.prompt ?? job.promptFile ?? "").slice(0, 50);
  return `${job.id.padEnd(22)} ${job.cron.padEnd(14)} ${nextStr.padEnd(18)} ${on.padEnd(4)} ${prompt}`;
}

export function listCronJobsText(dir: string, filter: "all" | "user" = "all"): string {
  const jobs = loadCronJobs(dir);
  const filtered = filter === "user" ? jobs.filter(isUserCronJob) : jobs;
  if (filtered.length === 0) {
    return filter === "user" ? "Нет user-jobs (префикс user-)." : "Нет cron jobs.";
  }
  const lines = filtered.map(formatCronJobLine);
  return ["ID                   CRON           NEXT (local)       ON   PROMPT", ...lines].join("\n");
}

export function addUserCronJob(
  dir: string,
  draft: UserCronDraft,
  notify: { chatId: string; telegram?: boolean }
): { ok: boolean; message: string; job?: CronJob } {
  let jobs: CronJob[];
  try {
    jobs = loadCronJobs(dir);
  } catch (e) {
    return { ok: false, message: e instanceof CronJobsError ? e.message : String(e) };
  }
  const errs = validateUserCronDraft(draft, dir, jobs);
  if (errs.length) return { ok: false, message: errs.join("; ") };
  const job = buildUserCronJob(draft, notify);
  jobs.push(job);
  saveCronJobs(dir, jobs);
  const next = nextCronRun(job.cron);
  return {
    ok: true,
    message: `OK: job '${job.id}' added${next ? ` · next ${formatCronWhen(next)}` : ""}`,
    job,
  };
}

export function removeUserCronJob(dir: string, jobId: string): { ok: boolean; message: string } {
  const id = jobId.trim();
  if (!id) return { ok: false, message: "job id required" };
  if (PROTECTED_CRON_JOB_IDS.has(id)) {
    return { ok: false, message: `job '${id}' is protected (system job)` };
  }
  if (!id.startsWith(USER_CRON_JOB_PREFIX)) {
    return { ok: false, message: `only user- jobs can be removed via /schedule (got '${id}')` };
  }
  let jobs: CronJob[];
  try {
    jobs = loadCronJobs(dir);
  } catch (e) {
    return { ok: false, message: e instanceof CronJobsError ? e.message : String(e) };
  }
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx < 0) return { ok: false, message: `job '${id}' not found` };
  jobs.splice(idx, 1);
  saveCronJobs(dir, jobs);
  return { ok: true, message: `OK: removed job '${id}'` };
}

export function proposeUserCronJob(
  dir: string,
  draft: UserCronDraft,
  peer: { chatId: string; adapter: string }
): { ok: boolean; message: string; code?: string } {
  let jobs: CronJob[];
  try {
    jobs = loadCronJobs(dir);
  } catch (e) {
    return { ok: false, message: e instanceof CronJobsError ? e.message : String(e) };
  }
  const errs = validateUserCronDraft(draft, dir, jobs);
  if (errs.length) return { ok: false, message: errs.join("; ") };

  const data = loadCronSchedulePending(dir);
  const job = buildUserCronJob(draft, { chatId: peer.chatId, telegram: true });
  const existing = data.pending.find((p) => p.chatId === peer.chatId && p.job.id === job.id);
  const code = existing?.code ?? newScheduleCode();
  const entry: CronSchedulePendingEntry = {
    code,
    chatId: peer.chatId,
    adapter: peer.adapter,
    job,
    createdAt: new Date().toISOString(),
  };
  if (existing) {
    const idx = data.pending.indexOf(existing);
    data.pending[idx] = entry;
  } else {
    data.pending.push(entry);
  }
  saveCronSchedulePending(dir, data);

  const next = nextCronRun(job.cron);
  return {
    ok: true,
    code,
    message: [
      `Предложен cron job (ожидает подтверждения):`,
      `• id: ${job.id}`,
      `• cron: ${job.cron}${next ? ` → next ${formatCronWhen(next)}` : ""}`,
      `• prompt: ${job.prompt.slice(0, 120)}${job.prompt.length > 120 ? "…" : ""}`,
      ``,
      `Подтверди: /schedule approve ${code}`,
    ].join("\n"),
  };
}

export function approveCronSchedule(
  dir: string,
  code: string,
  chatId: string
): { ok: boolean; message: string } {
  const norm = code.trim().toUpperCase();
  if (!norm) return { ok: false, message: "код required" };
  const data = loadCronSchedulePending(dir);
  const idx = data.pending.findIndex((p) => p.code.toUpperCase() === norm);
  if (idx < 0) return { ok: false, message: `код «${code}» не найден` };
  const pending = data.pending[idx]!;
  if (pending.chatId !== chatId) {
    return { ok: false, message: "подтверждать может только чат, создавший proposal" };
  }

  const draft: UserCronDraft = {
    id: pending.job.id,
    cron: pending.job.cron,
    prompt: pending.job.prompt ?? "",
    skills: pending.job.skills,
    cwd: pending.job.cwd,
  };
  const out = addUserCronJob(dir, draft, {
    chatId: pending.job.notify?.chatId ?? chatId,
    telegram: pending.job.notify?.telegram,
  });
  if (!out.ok) return out;
  data.pending.splice(idx, 1);
  saveCronSchedulePending(dir, data);
  return { ok: true, message: out.message };
}

export function listPendingCronSchedulesText(dir: string, chatId?: string): string {
  const data = loadCronSchedulePending(dir);
  const rows = chatId ? data.pending.filter((p) => p.chatId === chatId) : data.pending;
  if (rows.length === 0) return "Нет pending proposals.";
  return rows
    .map(
      (p) =>
        `${p.code} · ${p.job.id} · ${p.job.cron} · ${p.job.prompt.slice(0, 60)}${p.job.prompt.length > 60 ? "…" : ""}`
    )
    .join("\n");
}

/** Parse `/schedule add 0 9 * * 1 user-weekly prompt words…` */
export function parseScheduleAddArgs(arg: string): UserCronDraft | null {
  const parts = arg.trim().split(/\s+/);
  if (parts.length < 8 || parts[0]?.toLowerCase() !== "add") return null;
  const cron = parts.slice(1, 6).join(" ");
  const id = parts[6]!;
  const prompt = parts.slice(7).join(" ").trim();
  if (!prompt) return null;
  return { id, cron, prompt };
}

export function scheduleSlashHelpText(): string {
  return [
    "**/schedule** — cron из чата (fallback):",
    "",
    "/schedule list — все jobs",
    "/schedule user — только user-*",
    "/schedule pending — ждут approve",
    "/schedule add `<cron>` `<id>` `<prompt…>` — сразу добавить",
    "/schedule remove `<id>` — удалить user-job",
    "/schedule approve `<код>` — подтвердить proposal от агента",
    "",
    "Пример: /schedule add `0 9 * * 1` `weekly-inbox` `Summarize open tasks`",
    "",
    "Агент: tool `cron_propose` → /schedule approve <код>",
  ].join("\n");
}
