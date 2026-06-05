/**
 * Resolve cron job prompt text from inline field or promptFile (issue I-3).
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { CronJob } from "./cronJobs.js";
import { CronJobsError } from "./cronJobs.js";

export function resolveCronPromptFilePath(job: CronJob, configDir: string): string {
  const rel = job.promptFile?.trim();
  if (!rel) throw new CronJobsError(`job '${job.id}' has no promptFile`);
  if (isAbsolute(rel)) return rel;

  const candidates: string[] = [];
  if (job.cwd?.trim()) candidates.push(resolve(job.cwd.trim(), rel));
  candidates.push(resolve(configDir, rel));
  const root = process.env.CSAGENT_ROOT?.trim();
  if (root) candidates.push(resolve(root, rel));

  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return candidates[0] ?? resolve(configDir, rel);
}

export function loadCronJobPromptText(job: CronJob, configDir: string): string {
  if (job.promptFile?.trim()) {
    const path = resolveCronPromptFilePath(job, configDir);
    if (!existsSync(path)) {
      throw new CronJobsError(`job '${job.id}' promptFile not found: ${path}`);
    }
    const text = readFileSync(path, "utf8").trim();
    if (!text) throw new CronJobsError(`job '${job.id}' promptFile is empty: ${path}`);
    return text;
  }
  const inline = job.prompt?.trim() ?? "";
  if (!inline) throw new CronJobsError(`job '${job.id}' requires prompt or promptFile`);
  return inline;
}
