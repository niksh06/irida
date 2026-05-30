/**
 * Telegram Bot API adapter (long polling, no extra deps) — issue 037 follow-up.
 */
import { type GatewayConfig, isChatAllowed } from "./gatewayConfig.js";
import { GatewaySessionRouter } from "./gatewayRouter.js";

export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export type TelegramFetch = (url: string, init?: RequestInit) => Promise<Response>;

export function telegramBotToken(cfg: GatewayConfig): string {
  const envName = cfg.telegramTokenEnv.trim() || "TELEGRAM_BOT_TOKEN";
  return (process.env[envName] ?? "").trim();
}

export async function telegramApiGet<T>(
  token: string,
  method: string,
  params: Record<string, string | number>,
  fetchFn: TelegramFetch = fetch
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const url = `https://api.telegram.org/bot${token}/${method}?${qs}`;
  const res = await fetchFn(url, { method: "GET" });
  const body = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!body.ok) throw new Error(body.description ?? `telegram ${method} failed`);
  return body.result as T;
}

export async function telegramGetUpdates(
  token: string,
  offset: number,
  timeoutSec: number,
  fetchFn: TelegramFetch = fetch
): Promise<TelegramUpdate[]> {
  return telegramApiGet(token, "getUpdates", { offset, timeout: timeoutSec }, fetchFn);
}

export async function telegramSendMessage(
  token: string,
  chatId: string,
  text: string,
  fetchFn: TelegramFetch = fetch
): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const body = (await res.json()) as { ok: boolean; description?: string };
  if (!body.ok) throw new Error(body.description ?? "telegram sendMessage failed");
}

export interface ProcessTelegramUpdateResult {
  handled: boolean;
  chatId?: string;
  reply?: string;
  error?: string;
}

/** Handle one Telegram update through the gateway router. */
export async function processTelegramUpdate(
  cfg: GatewayConfig,
  router: GatewaySessionRouter,
  update: TelegramUpdate
): Promise<ProcessTelegramUpdateResult> {
  const msg = update.message;
  if (!msg?.text?.trim()) return { handled: false };
  const chatId = String(msg.chat.id);
  if (!isChatAllowed(cfg, chatId)) {
    return { handled: true, chatId, error: "chat not allowed" };
  }
  const text = msg.text.trim();
  if (text.length > cfg.maxMessageLength) {
    return { handled: true, chatId, error: "message too long" };
  }
  if (router.isBusy(chatId)) {
    return { handled: true, chatId, error: "busy" };
  }
  try {
    const { reply } = await router.handleInbound(chatId, text);
    return { handled: true, chatId, reply };
  } catch (e) {
    return { handled: true, chatId, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface TelegramPoller {
  stop(): Promise<void>;
}

export interface TelegramPollerOptions {
  cfg: GatewayConfig;
  router: GatewaySessionRouter;
  fetchFn?: TelegramFetch;
  pollIntervalMs?: number;
  onLog?: (line: string) => void;
}

export function startTelegramPoller(opts: TelegramPollerOptions): TelegramPoller {
  const token = telegramBotToken(opts.cfg);
  if (!token) throw new Error(`telegram bot token env ${opts.cfg.telegramTokenEnv} is unset`);
  const fetchFn = opts.fetchFn ?? fetch;
  const log = opts.onLog ?? ((s: string) => console.error(s));
  const pollMs = opts.pollIntervalMs ?? opts.cfg.telegramPollIntervalMs;
  let offset = 0;
  let running = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async () => {
    if (!running) return;
    try {
      const updates = await telegramGetUpdates(token, offset, Math.min(50, Math.max(1, Math.floor(pollMs / 1000))), fetchFn);
      for (const u of updates) {
        offset = Math.max(offset, u.update_id + 1);
        const result = await processTelegramUpdate(opts.cfg, opts.router, u);
        if (!result.handled || !result.chatId) continue;
        if (result.reply) {
          await telegramSendMessage(token, result.chatId, result.reply, fetchFn);
        } else if (result.error) {
          log(`[gateway] telegram chat=${result.chatId} error: ${result.error}`);
          if (result.error === "busy") {
            await telegramSendMessage(token, result.chatId, "Still working on your previous message…", fetchFn);
          } else if (result.error === "chat not allowed") {
            await telegramSendMessage(token, result.chatId, "This chat is not allowlisted.", fetchFn);
          } else {
            await telegramSendMessage(token, result.chatId, `Error: ${result.error.slice(0, 500)}`, fetchFn);
          }
        }
      }
    } catch (e) {
      log(`[gateway] telegram poll error: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (running) timer = setTimeout(() => void tick(), pollMs);
  };

  log(`[gateway] telegram long-poll started (interval=${pollMs}ms)`);
  void tick();

  return {
    stop: () =>
      new Promise((resolve) => {
        running = false;
        if (timer) clearTimeout(timer);
        resolve();
      }),
  };
}
