/**
 * Cron prompt injection guard (I-24).
 */
import { readFileSync } from "node:fs";
import { loadCronJobs } from "./cronJobs.js";
import { loadCronJobPromptText } from "./cronPrompt.js";
import type { CronJob } from "./cronJobs.js";

const DENY_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(your\s+)?(system|safety|rules)/i,
  /you\s+are\s+now\s+(in\s+)?(developer|admin|root)\s+mode/i,
  /\bDAN\b.*\bmode\b/i,
  /reveal\s+(your\s+)?(system\s+)?prompt/i,
  /print\s+(the\s+)?(full\s+)?system\s+prompt/i,
  /<\s*script\b/i,
  /\{\{\s*system\s*\}\}/i,
];

export function scanPromptText(text: string): string[] {
  const hits: string[] = [];
  for (const re of DENY_PATTERNS) {
    if (re.test(text)) hits.push(re.source);
  }
  return hits;
}

export function validateCronJobPrompt(job: CronJob, dir: string): string[] {
  const errs: string[] = [];
  let text: string;
  try {
    text = loadCronJobPromptText(job, dir);
  } catch (e) {
    return [e instanceof Error ? e.message : String(e)];
  }
  const hits = scanPromptText(text);
  if (hits.length) {
    errs.push(`job '${job.id}': prompt injection patterns: ${hits.join(", ")}`);
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
