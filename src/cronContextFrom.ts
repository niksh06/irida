/**
 * Cron contextFrom — inject upstream job artifact into prompt (I-41).
 */
import { loadCronContextArtifact } from "./cronContextArtifact.js";
import type { CronJob } from "./cronJobs.js";
import { CronJobsError } from "./cronJobs.js";

export const CONTEXT_FROM_PLACEHOLDER = "{{context_from}}";

export function validateContextFromGraph(jobs: CronJob[]): void {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  for (const job of jobs) {
    const ref = job.contextFrom?.trim();
    if (!ref) continue;
    if (!byId.has(ref)) {
      throw new CronJobsError(`job '${job.id}' contextFrom '${ref}' — unknown job id`);
    }
    if (ref === job.id) {
      throw new CronJobsError(`job '${job.id}' contextFrom cannot reference itself`);
    }
  }
  for (const job of jobs) {
    if (!job.contextFrom?.trim()) continue;
    const seen = new Set<string>();
    let cur: string | undefined = job.id;
    while (cur) {
      if (seen.has(cur)) {
        throw new CronJobsError(`contextFrom cycle detected (job '${job.id}')`);
      }
      seen.add(cur);
      cur = byId.get(cur)?.contextFrom?.trim();
    }
  }
}

export interface ContextFromResolveResult {
  output: string;
  missing: boolean;
  sourceJobId?: string;
}

export function resolveContextFromOutput(job: CronJob, dir: string): ContextFromResolveResult {
  const ref = job.contextFrom?.trim();
  if (!ref) return { output: "", missing: false };
  const artifact = loadCronContextArtifact(dir, ref);
  if (!artifact?.output) {
    console.error(`[cron] contextFrom job=${job.id} upstream=${ref} — artifact missing or empty`);
    return { output: "", missing: true, sourceJobId: ref };
  }
  return { output: artifact.output, missing: false, sourceJobId: ref };
}

export function applyContextFromPlaceholder(text: string, contextOutput: string): string {
  if (!text.includes(CONTEXT_FROM_PLACEHOLDER)) return text;
  return text.split(CONTEXT_FROM_PLACEHOLDER).join(contextOutput);
}

/** Topological order for due jobs: upstream contextFrom runs first (I-42). */
export function orderJobsForContextPipeline(jobs: CronJob[]): CronJob[] {
  if (jobs.length <= 1) return jobs;
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const ids = new Set(jobs.map((j) => j.id));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const j of jobs) {
    inDegree.set(j.id, 0);
  }
  for (const j of jobs) {
    const dep = j.contextFrom?.trim();
    if (dep && ids.has(dep)) {
      inDegree.set(j.id, (inDegree.get(j.id) ?? 0) + 1);
      dependents.set(dep, [...(dependents.get(dep) ?? []), j.id]);
    }
  }
  const queue = jobs.filter((j) => (inDegree.get(j.id) ?? 0) === 0);
  const out: CronJob[] = [];
  while (queue.length) {
    const job = queue.shift()!;
    out.push(job);
    for (const childId of dependents.get(job.id) ?? []) {
      const next = (inDegree.get(childId) ?? 1) - 1;
      inDegree.set(childId, next);
      if (next === 0) {
        const child = byId.get(childId);
        if (child) queue.push(child);
      }
    }
  }
  return out.length === jobs.length ? out : jobs;
}
