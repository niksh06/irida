/**
 * Append-only action transcript for reversible irida mutations (I-44).
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { loadConfig } from "./config.js";
import { redact } from "./redact.js";
import { iridaActionLog } from "./env.js";
import type { CronJob } from "./cronJobs.js";

export const ACTION_TRANSCRIPT_FILE = "action.transcript.jsonl";
const ROTATE_BYTES = 1024 * 1024;
const BODY_SNAPSHOT_MAX = 16 * 1024;

export type ActionTranscriptKind = "memory.delete" | "cron.user.add" | "cron.user.remove";

export interface ActionTranscriptEntry {
  ts: string;
  action: ActionTranscriptKind;
  reversible: boolean;
  payload: Record<string, unknown>;
}

export function actionTranscriptEnabled(): boolean {
  return iridaActionLog() !== "0";
}

export function actionTranscriptPath(dir: string): string {
  const cfg = loadConfig(dir);
  return resolve(dir, cfg.stateDir, ACTION_TRANSCRIPT_FILE);
}

function rotateIfNeeded(path: string): void {
  try {
    if (statSync(path).size >= ROTATE_BYTES) {
      renameSync(path, `${path}.1`);
    }
  } catch {
    /* no file */
  }
}

export function appendActionTranscript(dir: string, entry: ActionTranscriptEntry): void {
  if (!actionTranscriptEnabled()) return;
  try {
    const path = actionTranscriptPath(dir);
    mkdirSync(dirname(path), { recursive: true });
    rotateIfNeeded(path);
    const line = JSON.stringify({
      ...entry,
      payload: JSON.parse(redact(JSON.stringify(entry.payload))),
    });
    appendFileSync(path, line + "\n", { encoding: "utf8", mode: 0o600 });
  } catch {
    /* best-effort */
  }
}

export function hashCronExpr(cron: string): string {
  return createHash("sha256").update(cron.trim()).digest("hex").slice(0, 16);
}

export function capBodySnapshot(body: string): string {
  const cleaned = redact(body);
  if (Buffer.byteLength(cleaned, "utf8") <= BODY_SNAPSHOT_MAX) return cleaned;
  let end = cleaned.length;
  while (end > 0 && Buffer.byteLength(cleaned.slice(0, end), "utf8") > BODY_SNAPSHOT_MAX) {
    end -= 256;
  }
  return `${cleaned.slice(0, end)}\n… [truncated]`;
}

export function recordMemoryDelete(
  dir: string,
  payload: { name: string; wing: string; body: string; title?: string }
): void {
  if (payload.wing === "secure") {
    appendActionTranscript(dir, {
      ts: new Date().toISOString(),
      action: "memory.delete",
      reversible: false,
      payload: { name: payload.name, wing: payload.wing, reason: "secure wing" },
    });
    return;
  }
  appendActionTranscript(dir, {
    ts: new Date().toISOString(),
    action: "memory.delete",
    reversible: true,
    payload: {
      name: payload.name,
      wing: payload.wing,
      title: payload.title ?? payload.name,
      body: capBodySnapshot(payload.body),
    },
  });
}

export function recordCronUserAdd(dir: string, job: CronJob): void {
  appendActionTranscript(dir, {
    ts: new Date().toISOString(),
    action: "cron.user.add",
    reversible: false,
    payload: { id: job.id, cronHash: hashCronExpr(job.cron) },
  });
}

export function recordCronUserRemove(dir: string, job: CronJob): void {
  appendActionTranscript(dir, {
    ts: new Date().toISOString(),
    action: "cron.user.remove",
    reversible: true,
    payload: { job },
  });
}

function readTranscriptLines(dir: string): string[] {
  const path = actionTranscriptPath(dir);
  try {
    const raw = readFileSync(path, "utf8");
    return raw.split("\n").filter((l) => l.trim());
  } catch {
    return [];
  }
}

export function popLastReversibleAction(dir: string): ActionTranscriptEntry | null {
  const lines = readTranscriptLines(dir);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]!) as ActionTranscriptEntry;
      if (parsed.reversible) {
        const kept = [...lines.slice(0, i), ...lines.slice(i + 1)];
        const path = actionTranscriptPath(dir);
        if (kept.length) writeFileSync(path, kept.join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
        else {
          try {
            writeFileSync(path, "", { encoding: "utf8", mode: 0o600 });
          } catch {
            /* empty ok */
          }
        }
        return parsed;
      }
    } catch {
      continue;
    }
  }
  return null;
}
