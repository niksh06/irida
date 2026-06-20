/**
 * Execute cron jobs via run or chatEngine (issue 038).
 */
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { loadConfig, ConfigError } from "./config.js";
import { isBackgroundPaused } from "./backgroundPause.js";
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
  findDueCronMinute,
  loadCronJobs,
  loadCronState,
  saveCronState,
} from "./cronJobs.js";
import { loadCronJobPromptText } from "./cronPrompt.js";
import { scanPromptText, validateCronJobPrompt } from "./cronPromptGuard.js";
import { executeTopicDigestJob } from "./cronTopicDigest.js";
import { executeMemoryAuditBuiltin } from "./memoryAudit.js";
import { exportRecentSessions } from "./sessionExport.js";
import { ingestRecentSessions } from "./sessionIngest.js";
import { mineCursorTranscripts } from "./cursorTranscriptMine.js";
import {
  buildCursorDistillQueue,
  formatDistillQueueMarkdown,
} from "./cursorTranscriptDistill.js";
import { resolveCronScriptPath, runCronGate, runCronScript } from "./cronScript.js";
import {
  applyContextFromPlaceholder,
  orderJobsForContextPipeline,
  resolveContextFromOutput,
} from "./cronContextFrom.js";
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
  let text = loadCronJobPromptText(job, dir);
  const ctx = resolveContextFromOutput(job, dir);
  text = applyContextFromPlaceholder(text, ctx.output);
  return `[cron:${job.id}] ${text}`;
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

  const guardErrs = job.builtin || job.script ? [] : validateCronJobPrompt(job, configDir);
  if (guardErrs.length) {
    return withDuration(started, { ok: false, exitCode: EXIT.noperm, message: guardErrs.join("; ") });
  }

  // Script jobs (A2): deterministic shell, no SDK tokens. stdout = notify text;
  // empty stdout = silent success.
  if (job.script) {
    const path = resolveCronScriptPath(job, configDir, job.script);
    const run = runCronScript(path, { cwd: workDir });
    if (run.error || run.timedOut || run.exitCode !== 0) {
      const why = run.error ?? (run.timedOut ? "timeout" : `exit ${run.exitCode}`);
      return withDuration(started, {
        ok: false,
        exitCode: EXIT.software,
        message: `script failed (${why}): ${(run.stderr || run.stdout).slice(0, 300)}`,
      });
    }
    return withDuration(started, {
      ok: true,
      exitCode: EXIT.ok,
      message: run.stdout ? run.stdout.slice(0, 200) : "script ok (silent)",
      output: run.stdout || undefined,
      silent: !run.stdout,
    });
  }

  if (job.builtin === "memory-audit") {
    return withDuration(started, await executeMemoryAuditBuiltin(configDir));
  }
  if (job.builtin === "session-export") {
    try {
      const out = await exportRecentSessions(configDir);
      return withDuration(started, {
        ok: true,
        exitCode: EXIT.ok,
        message: `session-export: ${out.exported} session(s) → ${out.outDir}`,
      });
    } catch (e) {
      return withDuration(started, {
        ok: false,
        exitCode: EXIT.software,
        message: `session-export failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  if (job.builtin === "session-ingest") {
    try {
      const out = await ingestRecentSessions(configDir);
      const total = out.ingested + out.updated;
      return withDuration(started, {
        ok: true,
        exitCode: EXIT.ok,
        message: `session-ingest: ${total} note(s) (${out.ingested} new, ${out.updated} updated, ${out.skipped} skipped)`,
      });
    } catch (e) {
      return withDuration(started, {
        ok: false,
        exitCode: EXIT.software,
        message: `session-ingest failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  if (job.builtin === "cursor-mine") {
    try {
      const out = await mineCursorTranscripts(configDir, { all: true });
      const total = out.ingested + out.updated;
      return withDuration(started, {
        ok: true,
        exitCode: EXIT.ok,
        message: `cursor-mine: ${total} note(s) (${out.ingested} new, ${out.updated} updated, ${out.skipped} skipped)`,
      });
    } catch (e) {
      return withDuration(started, {
        ok: false,
        exitCode: EXIT.software,
        message: `cursor-mine failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  if (job.builtin === "cursor-distill-queue") {
    try {
      const out = await buildCursorDistillQueue(configDir, { limit: 10 });
      const markdown = formatDistillQueueMarkdown(out);
      return withDuration(started, {
        ok: true,
        exitCode: EXIT.ok,
        message: `cursor-distill-queue: ${out.candidates.length} candidate(s) (${out.skipped} skipped, mode=${out.mode})`,
        output: markdown,
        silent: out.candidates.length === 0,
      });
    } catch (e) {
      return withDuration(started, {
        ok: false,
        exitCode: EXIT.software,
        message: `cursor-distill-queue failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  if (job.builtin === "cursor-distill-backfill-queue") {
    try {
      const out = await buildCursorDistillQueue(configDir, { limit: 10, backfill: true });
      const markdown = formatDistillQueueMarkdown(out);
      return withDuration(started, {
        ok: true,
        exitCode: EXIT.ok,
        message: `cursor-distill-backfill-queue: ${out.candidates.length} candidate(s) (${out.skipped} skipped)`,
        output: markdown,
        silent: out.candidates.length === 0,
      });
    } catch (e) {
      return withDuration(started, {
        ok: false,
        exitCode: EXIT.software,
        message: `cursor-distill-backfill-queue failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  const promptBody = job.topicDelegates
    ? [job.topicPromptFile, job.synthesizePromptFile].filter(Boolean).join(" ")
    : loadCronJobPromptText(job, configDir);
  if (opts.checkSafety !== false && !job.builtin) {
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

  // Runtime scan of the fully assembled prompt (Wave B2): contextFrom output
  // is merged here and could carry injection text the create-time guard never saw.
  const assembledHits = scanPromptText(prompt);
  if (assembledHits.length) {
    return withDuration(started, {
      ok: false,
      exitCode: EXIT.noperm,
      message: `blocked — assembled prompt injection patterns: ${assembledHits.join(", ")}`,
    });
  }

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
      cronJob: job.id,
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
    channel: SESSION_CHANNEL.cron,
    cronJob: job.id,
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

/** Stale-lock TTL — covers the longest topic-digest runs. */
const CRON_TICK_LOCK_TTL_MS = 60 * 60 * 1000;

interface CronTickLock {
  release(): void;
}

/**
 * Cross-process tick lock (launchd tick + manual `cron tick` overlap).
 * `wx` open is atomic; a stale lock (crashed process) is broken by TTL.
 */
function acquireCronTickLock(dir: string): CronTickLock | null {
  const { lockPath, tryAcquire, release } = cronTickLockOps(dir);
  if (tryAcquire()) return { release };
  try {
    const stat = statSync(lockPath);
    if (Date.now() - stat.mtimeMs > CRON_TICK_LOCK_TTL_MS) {
      rmSync(lockPath, { force: true });
      if (tryAcquire()) return { release };
    }
  } catch {
    // Lock vanished between checks — one retry.
    if (tryAcquire()) return { release };
  }
  return null;
}

function cronTickLockOps(dir: string): {
  lockPath: string;
  tryAcquire: () => boolean;
  release: () => void;
} {
  const cfg = loadConfig(dir);
  const root = resolvePath(dir, cfg.stateDir);
  const lockPath = resolvePath(root, "cron.tick.lock");
  return {
    lockPath,
    tryAcquire: () => {
      try {
        mkdirSync(root, { recursive: true });
        writeFileSync(lockPath, `${process.pid} ${new Date().toISOString()}\n`, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        return true;
      } catch {
        return false;
      }
    },
    release: () => {
      rmSync(lockPath, { force: true });
    },
  };
}

export async function cronTick(
  opts: CronExecuteOptions & { at?: Date; force?: boolean } = {}
): Promise<CronTickResult> {
  const dir = opts.dir ?? process.cwd();
  const jobs = loadCronJobs(dir);

  if (isBackgroundPaused(dir)) {
    console.error(
      "[cron] tick skipped — background paused (`irida background resume` or unset CSAGENT_PAUSE_BACKGROUND)"
    );
    return { ran: [], skipped: jobs.map((j) => j.id), errors: [] };
  }

  const at = new Date(opts.at ?? new Date());
  at.setSeconds(0, 0);

  const lock = acquireCronTickLock(dir);
  if (!lock) {
    console.error("[cron] tick skipped — another tick is running (cron.tick.lock)");
    return { ran: [], skipped: jobs.map((j) => j.id), errors: [] };
  }
  try {
    return await cronTickLocked(dir, jobs, at, opts);
  } finally {
    lock.release();
  }
}

async function cronTickLocked(
  dir: string,
  jobs: CronJob[],
  at: Date,
  opts: CronExecuteOptions & { force?: boolean }
): Promise<CronTickResult> {
  const state = loadCronState(dir);
  const result: CronTickResult = { ran: [], skipped: [], errors: [] };

  const dueEntries: Array<{ job: CronJob; dueAt: Date }> = [];
  for (const job of jobs) {
    const dueAt = findDueCronMinute(job, at, state);
    if (!opts.force) {
      if (!dueAt) {
        result.skipped.push(job.id);
        continue;
      }
      dueEntries.push({ job, dueAt });
    } else if (job.enabled === false) {
      result.skipped.push(job.id);
    } else {
      dueEntries.push({ job, dueAt: dueAt ?? at });
    }
  }

  const ordered = orderJobsForContextPipeline(dueEntries.map((e) => e.job));
  const dueById = new Map(dueEntries.map((e) => [e.job.id, e]));
  const dueIds = new Set(dueEntries.map((e) => e.job.id));
  const failedDueThisTick = new Set<string>();

  for (const job of ordered) {
    const entry = dueById.get(job.id);
    if (!entry) continue;
    const { dueAt } = entry;
    const slot = dueAt;

    const upstream = job.contextFrom?.trim();
    if (upstream && dueIds.has(upstream) && failedDueThisTick.has(upstream)) {
      console.error(`[cron] job=${job.id} skipped — upstream '${upstream}' failed this tick`);
      state.lastRun[job.id] = cronMinuteKey(at);
      saveCronState(dir, state);
      saveCronJobResult(
        dir,
        job.id,
        {
          ok: false,
          exitCode: EXIT.software,
          message: `skipped — upstream '${upstream}' failed this tick`,
          durationMs: 0,
        },
        slot
      );
      result.skipped.push(job.id);
      continue;
    }

    const gate = runCronGate(job, dir);
    if (!gate.wake) {
      console.error(`[cron] job=${job.id} gated (skip): ${gate.reason}`);
      state.lastRun[job.id] = cronMinuteKey(at);
      saveCronState(dir, state);
      saveCronJobResult(
        dir,
        job.id,
        { ok: true, exitCode: EXIT.ok, message: `gated: ${gate.reason}`, durationMs: 0 },
        slot
      );
      result.skipped.push(job.id);
      continue;
    }

    console.error(`[cron] running job=${job.id} slot=${cronMinuteKey(slot)}`);
    state.lastRun[job.id] = cronMinuteKey(at);
    saveCronState(dir, state);
    try {
      const exec = await executeCronJob(job, opts);
      saveCronJobResult(dir, job.id, exec, slot);
      await sendCronJobNotify(job, exec, slot, dir);
      if (exec.ok) {
        result.ran.push(job.id);
        console.error(`[cron] job=${job.id} ok`);
      } else {
        failedDueThisTick.add(job.id);
        result.errors.push({ id: job.id, message: exec.message });
        console.error(`[cron] job=${job.id} failed: ${exec.message}`);
      }
    } catch (e) {
      failedDueThisTick.add(job.id);
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
