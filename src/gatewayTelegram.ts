/**
 * Telegram Bot API adapter (long polling, no extra deps) — issue 037 follow-up.
 */
import { type GatewayConfig, isChatAllowed } from "./gatewayConfig.js";
import { resolveTelegramBotToken } from "./credentials.js";
import { GatewaySessionRouter } from "./gatewayRouter.js";
import type { ActivityDetail } from "./host.js";

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

const TYPING_REFRESH_MS = 4000;
const TOOL_PREVIEW_MAX = 80;

export function telegramBotToken(cfg: GatewayConfig, dir: string = process.cwd()): string {
  const envName = cfg.telegramTokenEnv.trim() || "TELEGRAM_BOT_TOKEN";
  return resolveTelegramBotToken(dir, envName).value;
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

export async function telegramApiPost<T>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
  fetchFn: TelegramFetch = fetch
): Promise<T> {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
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

/** Telegram Bot API `sendMessage` text limit. */
export const TELEGRAM_MESSAGE_MAX = 4096;

/** Reserve for multipart header `[999/999]\n`. */
const TELEGRAM_PART_HEADER_SLACK = 20;

export function splitTelegramMessages(text: string, maxLen = TELEGRAM_MESSAGE_MAX): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxLen) return [trimmed];
  const chunks: string[] = [];
  let rest = trimmed;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf("\n", maxLen);
    if (cut < maxLen * 0.5) cut = maxLen;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** Split long text; prefix `[i/N]` when there is more than one part (each body ≤ limit). */
export function formatTelegramMultipartBodies(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const rough = splitTelegramMessages(trimmed, TELEGRAM_MESSAGE_MAX);
  if (rough.length === 1) return rough;
  const bodyMax = TELEGRAM_MESSAGE_MAX - TELEGRAM_PART_HEADER_SLACK;
  const parts = splitTelegramMessages(trimmed, bodyMax);
  return parts.map((p, i) => `[${i + 1}/${parts.length}]\n${p}`);
}

export async function telegramSendMessage(
  token: string,
  chatId: string,
  text: string,
  fetchFn: TelegramFetch = fetch
): Promise<void> {
  await telegramApiPost(token, "sendMessage", { chat_id: chatId, text }, fetchFn);
}

/** Send text as one or more Telegram messages (same chunking as cron digest). */
export async function telegramSendLongMessage(
  token: string,
  chatId: string,
  text: string,
  fetchFn: TelegramFetch = fetch
): Promise<number> {
  const bodies = formatTelegramMultipartBodies(text);
  for (const body of bodies) {
    await telegramSendMessage(token, chatId, body, fetchFn);
  }
  return bodies.length;
}

export async function telegramSendChatAction(
  token: string,
  chatId: string,
  action: "typing" | "cancel" = "typing",
  fetchFn: TelegramFetch = fetch
): Promise<void> {
  await telegramApiPost(token, "sendChatAction", { chat_id: chatId, action }, fetchFn);
}

export interface TelegramTypingLoop {
  stop(): void;
}

/** Keep Telegram "typing…" alive for long agent turns (expires after ~5s). */
export function startTelegramTypingLoop(
  token: string,
  chatId: string,
  fetchFn: TelegramFetch = fetch
): TelegramTypingLoop {
  let stopped = false;
  const ping = () => {
    if (stopped) return;
    void telegramSendChatAction(token, chatId, "typing", fetchFn).catch(() => {});
  };
  ping();
  const timer = setInterval(ping, TYPING_REFRESH_MS);
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

function toolEmoji(toolName: string, kind: ActivityDetail["kind"]): string {
  if (kind === "mcp") return "🔌";
  const n = toolName.toLowerCase();
  if (n.includes("shell") || n === "run_terminal_cmd") return "💻";
  if (n.includes("read")) return "📖";
  if (n.includes("write") || n.includes("edit")) return "✏️";
  if (n.includes("grep") || n.includes("glob") || n.includes("search")) return "🔍";
  return "⚙️";
}

/** Hermes-style one-liner for a tool call. */
export function formatTelegramToolProgressLine(activity: ActivityDetail): string {
  const toolName = activity.toolName?.trim() || activity.label?.trim() || "tool";
  const emoji = toolEmoji(toolName, activity.kind);
  const preview = (activity.command ?? "").trim().slice(0, TOOL_PREVIEW_MAX);
  if (preview) return `${emoji} ${toolName}: ${preview}`;
  return `${emoji} ${toolName}…`;
}

export interface TelegramToolProgressState {
  lastToolName: string | null;
  seenCallIds: Set<string>;
}

export function shouldEmitTelegramToolProgress(
  cfg: GatewayConfig,
  activity: ActivityDetail,
  state: TelegramToolProgressState
): boolean {
  if (!cfg.telegramShowToolProgress) return false;
  if (activity.phase !== "call") return false;
  if (activity.callId) {
    if (state.seenCallIds.has(activity.callId)) return false;
    state.seenCallIds.add(activity.callId);
  }
  if (cfg.telegramToolProgressMode === "new" && activity.toolName === state.lastToolName) {
    return false;
  }
  state.lastToolName = activity.toolName ?? null;
  return true;
}

export interface ProcessTelegramUpdateResult {
  handled: boolean;
  chatId?: string;
  reply?: string;
  error?: string;
}

export interface ProcessTelegramUpdateOptions {
  token: string;
  fetchFn?: TelegramFetch;
}

/** Handle one Telegram update through the gateway router. */
export async function processTelegramUpdate(
  cfg: GatewayConfig,
  router: GatewaySessionRouter,
  update: TelegramUpdate,
  opts: ProcessTelegramUpdateOptions
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

  const token = opts.token;
  const fetchFn = opts.fetchFn ?? fetch;
  const quickCommand = text === "/new";
  const typing =
    cfg.telegramShowTyping && !quickCommand
      ? startTelegramTypingLoop(token, chatId, fetchFn)
      : null;
  const toolState: TelegramToolProgressState = { lastToolName: null, seenCallIds: new Set() };
  const toolNotifies: Promise<void>[] = [];

  try {
    const { reply } = await router.handleInbound(chatId, text, {
      onActivity: (activity) => {
        if (!shouldEmitTelegramToolProgress(cfg, activity, toolState)) return;
        toolNotifies.push(
          (async () => {
            try {
              await telegramSendMessage(token, chatId, formatTelegramToolProgressLine(activity), fetchFn);
              if (cfg.telegramShowTyping) {
                await telegramSendChatAction(token, chatId, "typing", fetchFn);
              }
            } catch {
              /* non-fatal UX */
            }
          })()
        );
      },
    });
    await Promise.allSettled(toolNotifies);
    return { handled: true, chatId, reply };
  } catch (e) {
    await Promise.allSettled(toolNotifies);
    return { handled: true, chatId, error: e instanceof Error ? e.message : String(e) };
  } finally {
    typing?.stop();
  }
}

export interface TelegramPoller {
  stop(): Promise<void>;
}

export interface TelegramPollerOptions {
  cfg: GatewayConfig;
  router: GatewaySessionRouter;
  dir?: string;
  fetchFn?: TelegramFetch;
  pollIntervalMs?: number;
  onLog?: (line: string) => void;
}

export function startTelegramPoller(opts: TelegramPollerOptions): TelegramPoller {
  const dir = opts.dir ?? process.cwd();
  const token = telegramBotToken(opts.cfg, dir);
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
        const result = await processTelegramUpdate(opts.cfg, opts.router, u, { token, fetchFn });
        if (!result.handled || !result.chatId) continue;
        if (result.reply) {
          await telegramSendLongMessage(token, result.chatId, result.reply, fetchFn);
        } else if (result.error) {
          log(`[gateway] telegram chat=${result.chatId} error: ${result.error}`);
          if (result.error === "busy") {
            await telegramSendMessage(token, result.chatId, "Still working on your previous message…", fetchFn);
          } else if (result.error === "chat not allowed") {
            await telegramSendMessage(token, result.chatId, "This chat is not allowlisted.", fetchFn);
          } else if (result.error === "peer busy — previous turn still running") {
            await telegramSendMessage(token, result.chatId, "Still working on your previous message…", fetchFn);
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
