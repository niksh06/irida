/**
 * Script execution for cron jobs (Wave A, borrowed from hermes-evolution):
 *  - gateScript: cheap pre-check that can skip the SDK run entirely (A1);
 *  - script jobs: deterministic shell tasks with no SDK at all (A2).
 */
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { CronJob } from "./cronJobs.js";
import { CronJobsError } from "./cronJobs.js";
import { csagentRoot } from "./env.js";

export const CRON_GATE_TIMEOUT_MS = 30_000;
export const CRON_SCRIPT_TIMEOUT_MS = 5 * 60_000;

/** Same candidate order as promptFile: job cwd → config dir → CSAGENT_ROOT. */
export function resolveCronScriptPath(job: CronJob, configDir: string, rel: string): string {
  const trimmed = rel.trim();
  if (!trimmed) throw new CronJobsError(`job '${job.id}' has an empty script path`);
  if (isAbsolute(trimmed)) return trimmed;

  const candidates: string[] = [];
  if (job.cwd?.trim()) candidates.push(resolve(job.cwd.trim(), trimmed));
  candidates.push(resolve(configDir, trimmed));
  const root = csagentRoot();
  if (root) candidates.push(resolve(root, trimmed));

  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return candidates[0] ?? resolve(configDir, trimmed);
}

export interface CronScriptRun {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Spawn-level failure (missing file, EACCES …). */
  error?: string;
}

/** Run via bash so scripts work without the executable bit. */
export function runCronScript(
  path: string,
  opts: { cwd?: string; timeoutMs?: number } = {}
): CronScriptRun {
  const res = spawnSync("/bin/bash", [path], {
    cwd: opts.cwd,
    timeout: opts.timeoutMs ?? CRON_SCRIPT_TIMEOUT_MS,
    encoding: "utf8",
    env: process.env,
  });
  const timedOut = res.error != null && (res.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  return {
    exitCode: res.status ?? (res.error ? -1 : 0),
    stdout: (res.stdout ?? "").trim(),
    stderr: (res.stderr ?? "").trim(),
    timedOut,
    error: res.error && !timedOut ? res.error.message : undefined,
  };
}

export interface GateDecision {
  wake: boolean;
  reason: string;
}

/**
 * Gate contract (hermes-style): last non-empty stdout line may be JSON
 * {"wakeAgent": boolean, "reason"?: string}. Anything else — including script
 * failures — wakes the agent (fail-open: a broken gate must not kill digests).
 */
export function evaluateGateOutput(run: CronScriptRun): GateDecision {
  if (run.error) return { wake: true, reason: `gate error (${run.error}) — fail-open` };
  if (run.timedOut) return { wake: true, reason: "gate timeout — fail-open" };
  if (run.exitCode !== 0) {
    return { wake: true, reason: `gate exit ${run.exitCode} — fail-open` };
  }
  const lastLine = run.stdout.split("\n").filter((l) => l.trim()).pop() ?? "";
  try {
    const parsed = JSON.parse(lastLine) as { wakeAgent?: unknown; reason?: unknown };
    if (parsed.wakeAgent === false) {
      return { wake: false, reason: typeof parsed.reason === "string" ? parsed.reason : "gate: skip" };
    }
    if (parsed.wakeAgent === true) {
      return { wake: true, reason: typeof parsed.reason === "string" ? parsed.reason : "gate: wake" };
    }
  } catch {
    /* non-JSON output = no decision */
  }
  return { wake: true, reason: "gate produced no decision — wake" };
}

/** Run a job's gateScript; absent gate always wakes. */
export function runCronGate(job: CronJob, configDir: string): GateDecision {
  const rel = job.gateScript?.trim();
  if (!rel) return { wake: true, reason: "no gate" };
  const path = resolveCronScriptPath(job, configDir, rel);
  if (!existsSync(path)) {
    return { wake: true, reason: `gate script missing (${path}) — fail-open` };
  }
  const run = runCronScript(path, { cwd: job.cwd ?? configDir, timeoutMs: CRON_GATE_TIMEOUT_MS });
  return evaluateGateOutput(run);
}
