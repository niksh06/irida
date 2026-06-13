/**
 * Cron context artifacts — persist job output for downstream pipelines (I-40 / C1a).
 */
import { accessSync, constants, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { redact } from "./redact.js";
import { writeFileAtomic } from "./util.js";
import type { CronExecuteResult } from "./cronRunRecord.js";

export const CRON_CONTEXT_DIR = "cron.context";
export const CRON_CONTEXT_MAX_BYTES = 256 * 1024;

export type CronContextFormat = "text" | "json";

export interface CronContextArtifact {
  jobId: string;
  at: string;
  ok: boolean;
  exitCode: number;
  output: string;
  truncated?: boolean;
  format: CronContextFormat;
}

function contextRoot(dir: string): string {
  const cfg = loadConfig(dir);
  return resolve(dir, cfg.stateDir, CRON_CONTEXT_DIR);
}

export function cronContextArtifactPath(dir: string, jobId: string): string {
  return resolve(contextRoot(dir), `${jobId}.json`);
}

function detectFormat(text: string): CronContextFormat {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return "text";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed !== null && (typeof parsed === "object" || Array.isArray(parsed))) {
      return "json";
    }
  } catch {
    // not JSON
  }
  return "text";
}

function prepareOutput(raw: string): { output: string; truncated: boolean } {
  const cleaned = redact(raw);
  const bytes = Buffer.byteLength(cleaned, "utf8");
  if (bytes <= CRON_CONTEXT_MAX_BYTES) {
    return { output: cleaned, truncated: false };
  }
  let end = cleaned.length;
  while (end > 0 && Buffer.byteLength(cleaned.slice(0, end), "utf8") > CRON_CONTEXT_MAX_BYTES) {
    end -= 256;
  }
  return { output: `${cleaned.slice(0, end)}\n… [truncated]`, truncated: true };
}

/** Fail-soft: artifact write errors are logged, never fail the job. */
export function saveCronContextArtifact(
  dir: string,
  jobId: string,
  exec: CronExecuteResult,
  at: Date = new Date()
): void {
  if (!exec.ok) return;
  const raw = exec.output?.trim();
  if (!raw) return;
  try {
    const root = contextRoot(dir);
    mkdirSync(root, { recursive: true });
    const { output, truncated } = prepareOutput(raw);
    const artifact: CronContextArtifact = {
      jobId,
      at: at.toISOString(),
      ok: exec.ok,
      exitCode: exec.exitCode,
      output,
      format: detectFormat(output),
    };
    if (truncated) artifact.truncated = true;
    writeFileAtomic(
      cronContextArtifactPath(dir, jobId),
      JSON.stringify(artifact, null, 2) + "\n"
    );
  } catch (e) {
    console.error(
      `[cron] context artifact write failed job=${jobId}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

export function loadCronContextArtifact(
  dir: string,
  jobId: string
): CronContextArtifact | null {
  const path = cronContextArtifactPath(dir, jobId);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CronContextArtifact>;
    if (typeof parsed.jobId !== "string" || typeof parsed.output !== "string") return null;
    return {
      jobId: parsed.jobId,
      at: typeof parsed.at === "string" ? parsed.at : "",
      ok: parsed.ok === true,
      exitCode: typeof parsed.exitCode === "number" ? parsed.exitCode : 0,
      output: parsed.output,
      truncated: parsed.truncated === true,
      format: parsed.format === "json" ? "json" : "text",
    };
  } catch {
    return null;
  }
}

/** Doctor/gateway: warn when artifact dir exists but is not readable/writable. */
export function gatherCronContextDirIssue(dir: string): string | null {
  const root = contextRoot(dir);
  if (!existsSync(root)) return null;
  try {
    accessSync(root, constants.R_OK | constants.W_OK);
    return null;
  } catch {
    return `${root} not readable/writable`;
  }
}
