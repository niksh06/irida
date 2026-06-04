/**
 * Optional cron completion notifications (webhook or direct Telegram).
 */
import { resolveTelegramBotToken } from "./credentials.js";
import { telegramSendLongMessage } from "./gatewayTelegram.js";
import type { CronJob } from "./cronJobs.js";
import type { CronExecuteResult } from "./cronEngine.js";

export interface CronJobNotifyWebhook {
  mode: "webhook";
  chatId: string;
  webhookUrl: string;
  secretEnv: string;
}

export interface CronJobNotifyTelegram {
  mode: "telegram";
  chatId: string;
  tokenEnv: string;
}

export type CronJobNotifyTarget = CronJobNotifyWebhook | CronJobNotifyTelegram;

/** @deprecated use CronJobNotifyWebhook fields via resolveJobNotifyTarget */
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

export { TELEGRAM_MESSAGE_MAX, splitTelegramMessages } from "./gatewayTelegram.js";

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

export function resolveJobNotifyTarget(job: CronJob): CronJobNotifyTarget | null {
  const n = job.notify;
  if (!n || typeof n !== "object") return null;
  const chatId = typeof n.chatId === "string" ? n.chatId.trim() : "";
  if (!chatId) return null;
  if (n.telegram === true) {
    const tokenEnv =
      (typeof n.tokenEnv === "string" ? n.tokenEnv.trim() : "") || "TELEGRAM_BOT_TOKEN";
    return { mode: "telegram", chatId, tokenEnv };
  }
  const webhookUrl =
    (typeof n.webhookUrl === "string" ? n.webhookUrl.trim() : "") ||
    resolveEnv("CRON_NOTIFY_WEBHOOK_URL");
  if (!webhookUrl) return null;
  const secretEnv =
    (typeof n.secretEnv === "string" ? n.secretEnv.trim() : "") || "GATEWAY_WEBHOOK_SECRET";
  return { mode: "webhook", chatId, webhookUrl, secretEnv };
}

/** @deprecated use resolveJobNotifyTarget */
export function resolveJobNotify(job: CronJob): CronJobNotifyConfig | null {
  const t = resolveJobNotifyTarget(job);
  if (!t || t.mode !== "webhook") return null;
  return { chatId: t.chatId, webhookUrl: t.webhookUrl, secretEnv: t.secretEnv };
}

function formatNotifyText(payload: CronNotifyPayload, exec: CronExecuteResult): string {
  if (exec.output?.trim()) return exec.output.trim();
  const status = payload.ok ? "OK" : "FAILED";
  return `[cron:${payload.jobId}] ${status}\n${payload.message.slice(0, 2000)}`;
}

export async function sendCronJobNotify(
  job: CronJob,
  exec: CronExecuteResult,
  at: Date = new Date(),
  dir: string = process.cwd()
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
  const target = resolveJobNotifyTarget(job);
  if (!target) return;
  const text = formatNotifyText(payload, exec);
  try {
    if (target.mode === "telegram") {
      const token = resolveTelegramBotToken(dir, target.tokenEnv).value;
      if (!token) {
        console.error(`[cron] notify telegram: ${target.tokenEnv} unset job=${job.id}`);
        return;
      }
      await telegramSendLongMessage(token, target.chatId, text);
      return;
    }
    const secret = resolveEnv(target.secretEnv);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (secret) headers["X-Gateway-Secret"] = secret;
    const webhookText = formatNotifyText(payload, exec);
    await fetch(target.webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ chatId: target.chatId, text: webhookText }),
    });
  } catch (e) {
    console.error(
      `[cron] notify failed job=${job.id}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
