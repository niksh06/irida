/**
 * Morning cron health alert (I-38 optional): doctor cron check → Telegram on FAIL.
 */
import { existsSync } from "node:fs";
import { resolveTelegramBotToken } from "./credentials.js";
import { cronJobsPath, findLatestCronJobsBackup, loadCronJobs } from "./cronJobs.js";
import { gatherDoctorChecks, type DoctorCheck } from "./doctorChecks.js";
import { loadGatewayConfig } from "./gatewayConfig.js";
import { gatherGatewayStatus } from "./gatewayStatus.js";
import { enqueueOutbox } from "./gatewayOutbox.js";
import { telegramSendLongMessage } from "./gatewayTelegram.js";
import { resolveJobNotifyTarget } from "./cronNotify.js";

export function gatherCronHealthCheck(dir: string = process.cwd()): DoctorCheck {
  const path = cronJobsPath(dir);
  if (!existsSync(path)) {
    return {
      name: "cron jobs",
      ok: false,
      detail: "cron.jobs.json missing",
      fix: "copy deploy/cron.jobs.example.json → .agent/cron.jobs.json, then: irida cron list",
    };
  }
  const cron = gatherDoctorChecks(dir).find((c) => c.name === "cron jobs");
  if (cron) return cron;
  const bak = findLatestCronJobsBackup(dir);
  return {
    name: "cron jobs",
    ok: false,
    detail: "cron.jobs.json unreadable",
    fix: bak ? `restore: cp "${bak}" "${path}"` : "compare with deploy/cron.jobs.example.json",
  };
}

export function formatDoctorCronMorningAlert(check: DoctorCheck, dir: string): string {
  const status = gatherGatewayStatus(dir).find((r) => r.name === "cron jobs");
  const lines = ["🌅 morning cron health FAIL", `doctor: ${check.detail}`];
  if (status) lines.push(`status: ${status.detail}`);
  if (check.fix) lines.push(`fix: ${check.fix}`);
  return lines.join("\n");
}

export function resolveMorningAlertTarget(
  dir: string
): { chatId: string; tokenEnv: string } | null {
  try {
    for (const job of loadCronJobs(dir)) {
      const target = resolveJobNotifyTarget(job);
      if (target?.mode === "telegram") {
        return { chatId: target.chatId, tokenEnv: target.tokenEnv };
      }
    }
  } catch {
    // invalid cron file — fall through to gateway peers
  }
  try {
    const gw = loadGatewayConfig(dir);
    const chatId = gw.allowedChatIds[0]?.trim();
    if (chatId) return { chatId, tokenEnv: "TELEGRAM_BOT_TOKEN" };
  } catch {
    // gateway optional
  }
  return null;
}

/**
 * Exit 0 when cron health OK, the alert was delivered, or it was parked to the
 * gateway outbox (drain guarantees delivery, I-136); 1 only when the alert
 * could neither be sent nor parked.
 */
export async function cmdDoctorMorningAlert(dir: string = process.cwd()): Promise<number> {
  const check = gatherCronHealthCheck(dir);
  if (check.ok) {
    console.error("[doctor] morning cron health OK");
    return 0;
  }
  console.error(`[doctor] morning cron health FAIL: ${check.detail}`);
  const target = resolveMorningAlertTarget(dir);
  if (!target) {
    console.error("[doctor] morning cron alert: no telegram target (cron notify or gateway peer)");
    return 1;
  }
  const token = resolveTelegramBotToken(dir, target.tokenEnv).value;
  if (!token) {
    console.error(`[doctor] morning cron alert: ${target.tokenEnv} unset`);
    return 1;
  }
  const text = formatDoctorCronMorningAlert(check, dir);
  try {
    await telegramSendLongMessage(token, target.chatId, text);
    console.error("[doctor] morning cron alert sent");
  } catch (e) {
    console.error(
      `[doctor] morning cron alert failed: ${e instanceof Error ? e.message : String(e)}`
    );
    try {
      enqueueOutbox(dir, { chatId: target.chatId, text, format: "plain" });
      console.error("[doctor] morning cron alert parked in outbox (gateway will drain)");
      return 0;
    } catch {
      return 1;
    }
  }
  return 0;
}
