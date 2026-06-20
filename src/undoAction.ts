/**
 * Undo last reversible irida mutation (I-45).
 */
import { loadCronJobs, saveCronJobs, type CronJob } from "./cronJobs.js";
import { CronJobsError } from "./cronJobs.js";
import { createMemoryStore } from "./memoryStore.js";
import {
  popLastReversibleAction,
  type ActionTranscriptEntry,
} from "./actionTranscript.js";

function asCronJob(raw: unknown): CronJob | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.cron !== "string") return null;
  return raw as CronJob;
}

async function undoMemoryDelete(dir: string, entry: ActionTranscriptEntry): Promise<string> {
  const name = entry.payload.name;
  const wing = entry.payload.wing;
  const body = entry.payload.body;
  if (typeof name !== "string" || typeof wing !== "string" || typeof body !== "string") {
    return "invalid memory.delete transcript payload";
  }
  const store = createMemoryStore(dir, ".agent");
  try {
    const existing = await store.getNote(name);
    if (existing) return `note '${name}' already exists — undo skipped`;
    await store.upsertNote({
      name,
      wing,
      title: typeof entry.payload.title === "string" ? entry.payload.title : name,
      body,
    });
    return `OK: restored memory note '${name}'`;
  } finally {
    await store.close();
  }
}

function undoCronUserRemove(dir: string, entry: ActionTranscriptEntry): string {
  const job = asCronJob(entry.payload.job);
  if (!job) return "invalid cron.user.remove transcript payload";
  let jobs: CronJob[];
  try {
    jobs = loadCronJobs(dir);
  } catch (e) {
    return e instanceof CronJobsError ? e.message : String(e);
  }
  if (jobs.some((j) => j.id === job.id)) {
    return `job '${job.id}' already exists — undo skipped`;
  }
  jobs.push(job);
  try {
    saveCronJobs(dir, jobs);
  } catch (e) {
    return e instanceof CronJobsError ? e.message : String(e);
  }
  return `OK: restored cron job '${job.id}'`;
}

export async function undoLastAction(dir: string): Promise<{ ok: boolean; message: string }> {
  const entry = popLastReversibleAction(dir);
  if (!entry) return { ok: false, message: "Нечего отменять (нет reversible записей в transcript)." };

  switch (entry.action) {
    case "memory.delete":
      return { ok: true, message: await undoMemoryDelete(dir, entry) };
    case "cron.user.remove":
      return { ok: true, message: undoCronUserRemove(dir, entry) };
    default:
      return { ok: false, message: `Action '${entry.action}' is not undoable.` };
  }
}
