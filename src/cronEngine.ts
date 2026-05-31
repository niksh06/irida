/**
 * Execute cron jobs via run or chatEngine (issue 038).
 */
import { loadConfig, ConfigError } from "./config.js";
import { API_KEY_HELP, resolveApiKey } from "./credentials.js";
import { openChatSession } from "./chatEngine.js";
import { SESSION_CHANNEL } from "./sessionChannel.js";
import { cmdRun } from "./run.js";
import { safetyGate } from "./safety.js";
import { createStore } from "./store.js";
import { EXIT, type ExitCode } from "./exit.js";
import { cronMinuteKey } from "./cronSchedule.js";
import { sendCronJobNotify } from "./cronNotify.js";
import {
  type CronJob,
  loadCronState,
  saveCronState,
} from "./cronJobs.js";
import { buildSeenPostsPromptSection } from "./memoryDedup.js";
import type { SdkLike } from "./host.js";
import type { SdkCreateLike, SdkResumeLike } from "./host.js";

export interface CronExecuteOptions {
  dir?: string;
  sdk?: SdkLike & SdkCreateLike & SdkResumeLike;
  /** When false, skip safety (tests only). */
  checkSafety?: boolean;
}

export interface CronExecuteResult {
  ok: boolean;
  exitCode: ExitCode;
  message: string;
}

function jobDir(job: CronJob, base: string): string {
  return job.cwd ?? base;
}

function cronPrompt(job: CronJob): string {
  return `[cron:${job.id}] ${job.prompt}`;
}

async function resolveCronPrompt(job: CronJob, dir: string): Promise<string> {
  let body = cronPrompt(job);
  if (job.memoryFactsSubject === "seen_post") {
    const block = await buildSeenPostsPromptSection(dir, { limit: job.memoryFactsLimit ?? 80 });
    body = `${block}\n\n${body}`;
  }
  return body;
}

export async function executeCronJob(
  job: CronJob,
  opts: CronExecuteOptions = {}
): Promise<CronExecuteResult> {
  const baseDir = opts.dir ?? process.cwd();
  const dir = jobDir(job, baseDir);

  const { key: apiKey } = resolveApiKey(dir);
  if (!apiKey) {
    return { ok: false, exitCode: EXIT.config, message: API_KEY_HELP };
  }

  try {
    loadConfig(dir);
  } catch (e) {
    return {
      ok: false,
      exitCode: EXIT.config,
      message: e instanceof ConfigError ? e.message : String(e),
    };
  }

  const prompt = await resolveCronPrompt(job, dir);
  if (opts.checkSafety !== false) {
    const gate = await safetyGate({
      prompt: job.prompt,
      interactive: false,
      override: job.yesIUnderstand,
    });
    if (!gate.allowed) {
      return {
        ok: false,
        exitCode: EXIT.noperm,
        message: `blocked — ${gate.reason}`,
      };
    }
  }

  if (job.sessionId) {
    const store = createStore(dir, loadConfig(dir).stateDir);
    try {
      if (!(await store.getSession(job.sessionId))) {
        return {
          ok: false,
          exitCode: EXIT.usage,
          message: `session '${job.sessionId}' not found`,
        };
      }
    } finally {
      await store.close();
    }

    const opened = await openChatSession({
      dir,
      sdk: opts.sdk,
      resumeSessionId: job.sessionId,
      skills: job.skills,
      yesIUnderstand: job.yesIUnderstand,
      interactive: false,
      channel: SESSION_CHANNEL.cron,
      confirm: async () => false,
      onLog: (line) => console.error(line),
    });
    if (!opened.ok) {
      return { ok: false, exitCode: opened.code, message: opened.message };
    }
    try {
      const out = await opened.session.sendTurn(prompt);
      if (out.kind === "ok") {
        return { ok: true, exitCode: EXIT.ok, message: out.assistantText.slice(0, 200) || "finished" };
      }
      if (out.kind === "blocked") {
        return { ok: false, exitCode: EXIT.noperm, message: out.reason };
      }
      return {
        ok: false,
        exitCode: EXIT.software,
        message: out.message,
      };
    } finally {
      await opened.session.close();
    }
  }

  const code = await cmdRun(prompt, {
    dir,
    sdk: opts.sdk,
    skills: job.skills,
    yesIUnderstand: job.yesIUnderstand,
  });
  return {
    ok: code === EXIT.ok,
    exitCode: code,
    message: code === EXIT.ok ? "finished" : `run exited ${code}`,
  };
}

export interface CronTickResult {
  ran: string[];
  skipped: string[];
  errors: Array<{ id: string; message: string }>;
}

export async function cronTick(
  opts: CronExecuteOptions & { at?: Date; force?: boolean } = {}
): Promise<CronTickResult> {
  const dir = opts.dir ?? process.cwd();
  const { loadCronJobs } = await import("./cronJobs.js");
  const jobs = loadCronJobs(dir);
  const at = opts.at ?? new Date();
  at.setSeconds(0, 0);

  const state = loadCronState(dir);
  const result: CronTickResult = { ran: [], skipped: [], errors: [] };

  for (const job of jobs) {
    if (!opts.force) {
      const { isJobDue } = await import("./cronJobs.js");
      if (!isJobDue(job, at, state)) {
        result.skipped.push(job.id);
        continue;
      }
    } else if (job.enabled === false) {
      result.skipped.push(job.id);
      continue;
    }

    console.error(`[cron] running job=${job.id}`);
    try {
      const exec = await executeCronJob(job, opts);
      state.lastRun[job.id] = cronMinuteKey(at);
      saveCronState(dir, state);
      await sendCronJobNotify(job, exec, at);
      if (exec.ok) {
        result.ran.push(job.id);
        console.error(`[cron] job=${job.id} ok`);
      } else {
        result.errors.push({ id: job.id, message: exec.message });
        console.error(`[cron] job=${job.id} failed: ${exec.message}`);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      result.errors.push({ id: job.id, message });
      console.error(`[cron] job=${job.id} error: ${message}`);
    }
  }

  return result;
}

export function markCronJobRan(dir: string, jobId: string, at: Date = new Date()): void {
  const state = loadCronState(dir);
  state.lastRun[jobId] = cronMinuteKey(at);
  saveCronState(dir, state);
}
