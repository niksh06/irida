/**
 * Execute cron jobs via run or chatEngine (issue 038).
 */
import { loadConfig, ConfigError } from "./config.js";
import { API_KEY_HELP, resolveApiKey } from "./credentials.js";
import { openChatSession } from "./chatEngine.js";
import { SESSION_CHANNEL } from "./sessionChannel.js";
import { runPrompt } from "./run.js";
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
import { loadCronJobPromptText } from "./cronPrompt.js";
import { validateCronJobPrompt } from "./cronPromptGuard.js";
import { executeTopicDigestJob } from "./cronTopicDigest.js";
import {
  saveCronJobResult,
  type CronExecuteResult,
  type CronTopicSummary,
} from "./cronRunRecord.js";
import type { SdkLike } from "./host.js";
import type { SdkCreateLike, SdkResumeLike } from "./host.js";

export interface CronExecuteOptions {
  dir?: string;
  sdk?: SdkLike & SdkCreateLike & SdkResumeLike;
  /** When false, skip safety (tests only). */
  checkSafety?: boolean;
}

export type { CronExecuteResult, CronTopicSummary } from "./cronRunRecord.js";

async function resolveCronPrompt(job: CronJob, dir: string): Promise<string> {
  const text = loadCronJobPromptText(job, dir);
  let body = `[cron:${job.id}] ${text}`;
  if (job.memoryFactsSubject === "seen_post") {
    const block = await buildSeenPostsPromptSection(dir, { limit: job.memoryFactsLimit ?? 80 });
    body = `${block}\n\n${body}`;
  }
  return body;
}

function withDuration<T extends CronExecuteResult>(started: number, result: T): T {
  return { ...result, durationMs: Date.now() - started };
}

export async function executeCronJob(
  job: CronJob,
  opts: CronExecuteOptions = {}
): Promise<CronExecuteResult> {
  const started = Date.now();
  const configDir = opts.dir ?? process.cwd();
  const workDir = job.cwd ?? configDir;

  const { key: apiKey } = resolveApiKey(configDir);
  if (!apiKey) {
    return withDuration(started, { ok: false, exitCode: EXIT.config, message: API_KEY_HELP });
  }

  try {
    loadConfig(configDir);
  } catch (e) {
    return withDuration(started, {
      ok: false,
      exitCode: EXIT.config,
      message: e instanceof ConfigError ? e.message : String(e),
    });
  }

  const guardErrs = validateCronJobPrompt(job, configDir);
  if (guardErrs.length) {
    return withDuration(started, { ok: false, exitCode: EXIT.noperm, message: guardErrs.join("; ") });
  }

  const promptBody = job.topicDelegates
    ? [job.topicPromptFile, job.synthesizePromptFile].filter(Boolean).join(" ")
    : loadCronJobPromptText(job, configDir);
  if (opts.checkSafety !== false) {
    const gate = await safetyGate({
      prompt: promptBody,
      interactive: false,
      override: job.yesIUnderstand,
    });
    if (!gate.allowed) {
      return withDuration(started, {
        ok: false,
        exitCode: EXIT.noperm,
        message: `blocked — ${gate.reason}`,
      });
    }
  }

  if (job.topicDelegates) {
    const digest = await executeTopicDigestJob(job, configDir, {
      sdk: opts.sdk,
      onLog: (line) => console.error(line),
    });
    return withDuration(started, {
      ok: digest.ok,
      exitCode: digest.exitCode,
      message: digest.message,
      output: digest.output,
      topicSummaries: digest.topicSummaries,
    });
  }

  const prompt = await resolveCronPrompt(job, configDir);

  if (job.sessionId) {
    const store = createStore(configDir, loadConfig(configDir).stateDir);
    try {
      if (!(await store.getSession(job.sessionId))) {
        return withDuration(started, {
          ok: false,
          exitCode: EXIT.usage,
          message: `session '${job.sessionId}' not found`,
        });
      }
    } finally {
      await store.close();
    }

    const opened = await openChatSession({
      dir: configDir,
      cwd: workDir,
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
      return withDuration(started, { ok: false, exitCode: opened.code, message: opened.message });
    }
    try {
      const out = await opened.session.sendTurn(prompt);
      if (out.kind === "ok") {
        const text = out.assistantText;
        return withDuration(started, {
          ok: true,
          exitCode: EXIT.ok,
          message: text.slice(0, 200) || "finished",
          output: text,
        });
      }
      if (out.kind === "blocked") {
        return withDuration(started, { ok: false, exitCode: EXIT.noperm, message: out.reason });
      }
      return withDuration(started, {
        ok: false,
        exitCode: EXIT.software,
        message: out.message,
      });
    } finally {
      await opened.session.close();
    }
  }

  const run = await runPrompt(prompt, {
    dir: configDir,
    cwd: workDir,
    sdk: opts.sdk,
    skills: job.skills,
    yesIUnderstand: job.yesIUnderstand,
  });
  return withDuration(started, {
    ok: run.exitCode === EXIT.ok,
    exitCode: run.exitCode,
    message: run.exitCode === EXIT.ok ? run.text.slice(0, 200) || "finished" : `run exited ${run.exitCode}`,
    output: run.text,
  });
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
    const { findDueCronMinute } = await import("./cronJobs.js");
    const dueAt = findDueCronMinute(job, at, state);
    if (!opts.force) {
      if (!dueAt) {
        result.skipped.push(job.id);
        continue;
      }
    } else if (job.enabled === false) {
      result.skipped.push(job.id);
      continue;
    }

    const slot = dueAt ?? at;
    console.error(`[cron] running job=${job.id} slot=${cronMinuteKey(slot)}`);
    try {
      const exec = await executeCronJob(job, opts);
      state.lastRun[job.id] = cronMinuteKey(slot);
      saveCronState(dir, state);
      saveCronJobResult(dir, job.id, exec, slot);
      await sendCronJobNotify(job, exec, slot, dir);
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
