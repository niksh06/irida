/**
 * Optional cron completion notifications (issue 038 P2 stub → gateway webhook).
 */
import type { CronJob } from "./cronJobs.js";
import type { CronExecuteResult } from "./cronEngine.js";

export interface CronJobNotifyConfig {
  chatId: string;
  webhookUrl: string;
  secretEnv: string;
}

export interface CronNotifyPayload {
  jobId: string;
  ok: boolean;
  message: string;
  at: string;
}

export type CronNotifyHook = (payload: CronNotifyPayload) => void | Promise<void>;

let customHook: CronNotifyHook | null = null;

/** Tests or gateway may register an in-process hook. */
export function setCronNotifyHook(hook: CronNotifyHook | null): void {
  customHook = hook;
}

export function getCronNotifyHook(): CronNotifyHook | null {
  return customHook;
}

function resolveEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function resolveJobNotify(job: CronJob): CronJobNotifyConfig | null {
  const n = job.notify;
  if (!n || typeof n !== "object") return null;
  const chatId = typeof n.chatId === "string" ? n.chatId.trim() : "";
  if (!chatId) return null;
  const webhookUrl =
    (typeof n.webhookUrl === "string" ? n.webhookUrl.trim() : "") ||
    resolveEnv("CRON_NOTIFY_WEBHOOK_URL");
  if (!webhookUrl) return null;
  const secretEnv =
    (typeof n.secretEnv === "string" ? n.secretEnv.trim() : "") || "GATEWAY_WEBHOOK_SECRET";
  return { chatId, webhookUrl, secretEnv };
}

function formatNotifyText(payload: CronNotifyPayload): string {
  const status = payload.ok ? "OK" : "FAILED";
  return `[cron:${payload.jobId}] ${status}\n${payload.message.slice(0, 2000)}`;
}

export async function sendCronJobNotify(
  job: CronJob,
  exec: CronExecuteResult,
  at: Date = new Date()
): Promise<void> {
  const payload: CronNotifyPayload = {
    jobId: job.id,
    ok: exec.ok,
    message: exec.message,
    at: at.toISOString(),
  };
  if (customHook) {
    await customHook(payload);
    return;
  }
  const notify = resolveJobNotify(job);
  if (!notify) return;
  const secret = resolveEnv(notify.secretEnv);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret) headers["X-Gateway-Secret"] = secret;
  const text = formatNotifyText(payload);
  try {
    await fetch(notify.webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ chatId: notify.chatId, text }),
    });
  } catch (e) {
    console.error(
      `[cron] notify failed job=${job.id}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
