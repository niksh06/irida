/**
 * Cron prompt injection guard (I-24).
 */
import { readFileSync } from "node:fs";
import { loadCronJobs } from "./cronJobs.js";
import { loadCronJobPromptText } from "./cronPrompt.js";
import type { CronJob } from "./cronJobs.js";

import { scanThreatPatterns } from "./promptThreatScan.js";

export function scanPromptText(text: string): string[] {
  return scanThreatPatterns(text);
}

export function validateCronJobPrompt(job: CronJob, dir: string): string[] {
  if (job.builtin || job.script) return [];
  const errs: string[] = [];
  const texts: string[] = [];
  if (job.topicDelegates) {
    for (const rel of [job.topicPromptFile, job.synthesizePromptFile]) {
      if (!rel?.trim()) continue;
      try {
        texts.push(loadCronJobPromptText({ ...job, promptFile: rel.trim(), prompt: undefined }, dir));
      } catch (e) {
        errs.push(e instanceof Error ? e.message : String(e));
      }
    }
  } else {
    try {
      texts.push(loadCronJobPromptText(job, dir));
    } catch (e) {
      return [e instanceof Error ? e.message : String(e)];
    }
  }
  for (const text of texts) {
    const hits = scanPromptText(text);
    if (hits.length) {
      errs.push(`job '${job.id}': prompt injection patterns: ${hits.join(", ")}`);
    }
  }
  return errs;
}

export function gatherCronPromptGuardIssues(dir: string): string[] {
  const jobs = loadCronJobs(dir);
  const all: string[] = [];
  for (const job of jobs) {
    all.push(...validateCronJobPrompt(job, dir));
  }
  return all;
}

/** Scan arbitrary prompt file (doctor). */
export function scanPromptFile(path: string): string[] {
  try {
    return scanPromptText(readFileSync(path, "utf8"));
  } catch (e) {
    return [`cannot read ${path}: ${(e as Error).message}`];
  }
}
