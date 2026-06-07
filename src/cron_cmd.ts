/**
 * `csagent cron list|run|tick` — scheduled jobs (issue 038).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, ConfigError } from "./config.js";
import {
  CronJobsError,
  CRON_JOBS_FILE,
  cronJobsPath,
  loadCronJobs,
  type CronJob,
} from "./cronJobs.js";
import { formatCronWhen, nextCronRun } from "./cronSchedule.js";
import { cronJobEnabled } from "./cronJobs.js";
import { executeCronJob, cronTick, markCronJobRan } from "./cronEngine.js";
import { resolveJobNotifyTarget, sendCronJobNotify, sendDigestQaAlertMessage } from "./cronNotify.js";
import { saveCronJobResult } from "./cronRunRecord.js";
import {
  DEFAULT_DIGEST_JOB_ID,
  digestNeverRan,
  evaluateDigestQa,
  formatDigestQaReport,
  saveDigestQaResult,
} from "./digestQa.js";
import { EXIT, type ExitCode } from "./exit.js";

import type { SdkLike, SdkCreateLike, SdkResumeLike } from "./host.js";

export interface CronCmdOptions {
  dir?: string;
  sdk?: SdkLike & SdkCreateLike & SdkResumeLike;
  /** Send Telegram alert when digest QA fails (morning re-check). */
  alert?: boolean;
  morning?: boolean;
}

export function cmdCronList(opts: CronCmdOptions = {}): ExitCode {
  const dir = opts.dir ?? process.cwd();
  let jobs: CronJob[];
  try {
    jobs = loadCronJobs(dir);
  } catch (e) {
    console.error("cron: " + (e instanceof CronJobsError ? e.message : String(e)));
    return EXIT.config;
  }
  const path = cronJobsPath(dir);
  if (jobs.length === 0) {
    console.log(`No jobs in ${path}`);
    console.log("Create .agent/cron.jobs.json — see: csagent cron help");
    return EXIT.ok;
  }
  console.log("ID               CRON            NEXT (local)       ON   PROMPT");
  for (const j of jobs) {
    const next = cronJobEnabled(j) ? nextCronRun(j.cron) : null;
    const nextStr = next ? formatCronWhen(next) : "—";
    const on = cronJobEnabled(j) ? "yes" : "no";
    console.log(
      `${j.id.padEnd(16)} ${j.cron.padEnd(15)} ${nextStr.padEnd(18)} ${on.padEnd(4)} ${(j.builtin ?? j.prompt ?? j.promptFile ?? "").slice(0, 40)}`
    );
  }
  return EXIT.ok;
}

export async function cmdCronRun(jobId: string, opts: CronCmdOptions = {}): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  if (!jobId.trim()) {
    console.error("cron run: job id required");
    return EXIT.usage;
  }
  let jobs: CronJob[];
  try {
    jobs = loadCronJobs(dir);
  } catch (e) {
    console.error("cron: " + (e instanceof CronJobsError ? e.message : String(e)));
    return EXIT.config;
  }
  const job = jobs.find((j) => j.id === jobId);
  if (!job) {
    console.error(`cron: job '${jobId}' not found`);
    return EXIT.usage;
  }
  const exec = await executeCronJob(job, { dir, sdk: opts.sdk });
  const at = new Date();
  markCronJobRan(dir, job.id, at);
  saveCronJobResult(dir, job.id, exec, at);
  await sendCronJobNotify(job, exec, at, dir);
  if (exec.ok) {
    console.log(`cron: job '${job.id}' finished`);
    return EXIT.ok;
  }
  console.error(`cron: job '${job.id}' failed — ${exec.message}`);
  return exec.exitCode;
}

export async function cmdCronQa(jobId: string | undefined, opts: CronCmdOptions = {}): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  const id = (jobId ?? DEFAULT_DIGEST_JOB_ID).trim();
  if (!id) {
    console.error("cron qa: job id required");
    return EXIT.usage;
  }
  const report = evaluateDigestQa(dir, id);
  saveDigestQaResult(dir, id, report);
  console.log(formatDigestQaReport(report));
  if (!report.ok) {
    if (opts.alert) {
      if (opts.morning && digestNeverRan(dir, id)) {
        console.error(
          `[cron] morning QA skip alert job=${id} — digest never ran yet (await 23:59 or manual smoke)`
        );
        return EXIT.software;
      }
      let job: CronJob | undefined;
      try {
        job = loadCronJobs(dir).find((j) => j.id === id);
      } catch {
        job = undefined;
      }
      const target = job ? resolveJobNotifyTarget(job) : null;
      if (job && target) {
        const label = opts.morning ? "morning" : "manual";
        console.error(`[cron] digest QA FAIL — sending ${label} alert`);
        await sendDigestQaAlertMessage(job, report, dir, target, { morning: opts.morning });
      } else {
        console.error("[cron] digest QA FAIL — no notify target (set job.notify in cron.jobs.json)");
      }
    }
    return EXIT.software;
  }
  if (opts.morning) console.error(`[cron] morning digest QA pass job=${id}`);
  return EXIT.ok;
}

export async function cmdCronTick(opts: CronCmdOptions = {}): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  try {
    loadCronJobs(dir);
  } catch (e) {
    console.error("cron: " + (e instanceof CronJobsError ? e.message : String(e)));
    return EXIT.config;
  }
  const result = await cronTick({ dir, sdk: opts.sdk });
  if (result.ran.length) console.log(`cron tick: ran ${result.ran.join(", ")}`);
  if (result.errors.length) {
    for (const err of result.errors) console.error(`cron tick: ${err.id} — ${err.message}`);
    return EXIT.software;
  }
  return EXIT.ok;
}

export async function cmdCron(argv: string[], opts: CronCmdOptions = {}): Promise<ExitCode> {
  const [sub, ...restArgs] = argv;
  const jobId = restArgs.find((a) => !a.startsWith("--")) ?? "";
  switch (sub) {
    case "list":
    case "ls":
      return cmdCronList(opts);
    case "run":
      return cmdCronRun(jobId ?? "", opts);
    case "tick":
      return cmdCronTick(opts);
    case "qa": {
      const alert = restArgs.includes("--alert");
      const morning = restArgs.includes("--morning");
      return cmdCronQa(jobId || undefined, { ...opts, alert, morning });
    }
    case undefined:
    case "-h":
    case "--help":
    case "help":
      console.log(`Usage:
  csagent cron list              show jobs and next run time
  csagent cron run <id>          execute one job now
  csagent cron tick              run all due jobs (call from system cron)
  csagent cron qa [job-id]       automated digest QA (default: tparser-daily-digest)
  csagent cron qa --alert        QA + Telegram alert on FAIL
  csagent cron qa --morning --alert   morning re-check (launchd 08:00)

Jobs file: .agent/cron.jobs.json
Example crontab (every 5 min):
  */5 * * * * cd /path/to/project && csagent cron tick

Job JSON:
{
  "version": 1,
  "jobs": [
    {
      "id": "nightly-summary",
      "cron": "0 9 * * *",
      "prompt": "Summarize open issues",
      "skills": ["review"],
      "sessionId": "sess_optional",
      "yesIUnderstand": false
    }
  ]
}
`);
      return EXIT.ok;
    default:
      console.error(`cron: unknown subcommand '${sub}'\n\nRun: csagent cron help`);
      return EXIT.usage;
  }
}

/** Write example jobs file (for tests/docs). */
export function writeExampleCronJobs(dir: string, jobs: CronJob[]): void {
  const cfg = loadConfig(dir);
  const root = resolve(dir, cfg.stateDir);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    resolve(root, CRON_JOBS_FILE),
    JSON.stringify({ version: 1, jobs }, null, 2) + "\n",
    { encoding: "utf8", mode: 0o600 }
  );
}
