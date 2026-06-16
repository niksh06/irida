/**
 * Telegram Bot API adapter (long polling, no extra deps) — issue 037 follow-up.
 */
import { type GatewayConfig, isChatAllowed } from "./gatewayConfig.js";
import { resolveTelegramBotToken, validateTelegramBotTokenFormat } from "./credentials.js";
import {
  formatTelegramHtml,
  telegramHtmlDiffers,
  type TelegramMessageFormat,
} from "./telegramFormat.js";
import { drainOutbox, enqueueOutbox, resolveOutboxDeliveryFormat, sendOutboxParkAck } from "./gatewayOutbox.js";
import { GatewaySessionRouter } from "./gatewayRouter.js";
import { tryRegisterPairing } from "./gatewayPairing.js";
import { gatewayTelegramBotCommands, isGatewaySlashCommand } from "./gatewaySlash.js";
import type { ActivityDetail } from "./host.js";
import { emitServiceLog, type ServiceLogSink } from "./serviceLog.js";
import { loadTelegramPollOffset, saveTelegramPollOffset } from "./gatewayTelegramOffset.js";

export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
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
  fetchFn: TelegramFetch = fetch,
  fetchTimeoutMs?: number
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const url = `https://api.telegram.org/bot${token}/${method}?${qs}`;
  const init: RequestInit = { method: "GET" };
  if (fetchTimeoutMs != null && fetchTimeoutMs > 0) {
    init.signal = AbortSignal.timeout(fetchTimeoutMs);
  }
  const res = await fetchFn(url, init);
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

/** Telegram getUpdates `timeout` param (seconds). Short poll (0) avoids VPN/proxy long-hold hangs. */
export function resolveTelegramGetUpdatesTimeoutSec(_pollIntervalMs: number): number {
  return 0;
}

/** Global Bot API filter — must include message/group traffic (not channel_post only). */
export const TELEGRAM_GATEWAY_ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
  "callback_query",
] as const;

/** Required for gateway inbound (private + group messages). */
export const TELEGRAM_INBOUND_MESSAGE_UPDATE = "message";

export interface TelegramAllowedUpdatesAssessment {
  ok: boolean;
  detail: string;
  allowedUpdates: string[];
}

/** Probe Bot API global allowed_updates (I-83). */
export async function assessTelegramAllowedUpdates(
  token: string,
  fetchFn: TelegramFetch = fetch
): Promise<TelegramAllowedUpdatesAssessment> {
  try {
    const info = await telegramApiGet<{ allowed_updates?: string[] }>(
      token,
      "getWebhookInfo",
      {},
      fetchFn,
      15_000
    );
    const allowed = info.allowed_updates ?? [];
    if (allowed.includes(TELEGRAM_INBOUND_MESSAGE_UPDATE)) {
      return {
        ok: true,
        detail: allowed.join(", ") || "(default)",
        allowedUpdates: allowed,
      };
    }
    return {
      ok: false,
      detail: allowed.length
        ? `missing message (got: ${allowed.join(", ")})`
        : "missing message (empty allowed_updates)",
      allowedUpdates: allowed,
    };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
      allowedUpdates: [],
    };
  }
}

/** Label update type for poll logging (I-87). */
export function describeTelegramUpdateType(update: TelegramUpdate): string {
  if (update.message) return "message";
  if (update.edited_message) return "edited_message";
  if (update.channel_post) return "channel_post";
  if (update.edited_channel_post) return "edited_channel_post";
  return "other";
}

export function summarizeTelegramUpdateTypes(updates: TelegramUpdate[]): string {
  const counts = new Map<string, number>();
  for (const u of updates) {
    const t = describeTelegramUpdateType(u);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].map(([k, v]) => `${k}:${v}`).join(",");
}

export async function telegramGetUpdates(
  token: string,
  offset: number,
  timeoutSec: number,
  fetchFn: TelegramFetch = fetch,
  allowedUpdates: readonly string[] = TELEGRAM_GATEWAY_ALLOWED_UPDATES
): Promise<TelegramUpdate[]> {
  // Short poll should return quickly; generous slack for slow proxies.
  const fetchTimeoutMs = timeoutSec <= 0 ? 15_000 : (timeoutSec + 15) * 1000;
  return telegramApiGet(
    token,
    "getUpdates",
    {
      offset,
      timeout: timeoutSec,
      allowed_updates: JSON.stringify([...allowedUpdates]),
    },
    fetchFn,
    fetchTimeoutMs
  );
}

/** Telegram Bot API `sendMessage` text limit. */
export const TELEGRAM_MESSAGE_MAX = 4096;

/** Bot API 10.1+ `sendRichMessage` markdown limit (32768 UTF-8 chars). */
export const TELEGRAM_RICH_MESSAGE_MAX = 32_000;

/** Reserve for multipart header `[999/999]\n`. */
const TELEGRAM_PART_HEADER_SLACK = 20;

export type { TelegramMessageFormat };

export function resolveTelegramSendFormat(
  opts: { format?: TelegramMessageFormat; html?: boolean } = {}
): TelegramMessageFormat {
  if (opts.format) return opts.format;
  if (opts.html === true) return "rich";
  if (opts.html === false) return "plain";
  return "plain";
}

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

function formatMultipartBodies(text: string, maxLen: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const rough = splitTelegramMessages(trimmed, maxLen);
  if (rough.length === 1) return rough;
  const bodyMax = maxLen - TELEGRAM_PART_HEADER_SLACK;
  const parts = splitTelegramMessages(trimmed, bodyMax);
  return parts.map((p, i) => `[${i + 1}/${parts.length}]\n${p}`);
}

/** Split long text; prefix `[i/N]` when there is more than one part (each body ≤ limit). */
export function formatTelegramMultipartBodies(text: string): string[] {
  return formatMultipartBodies(text, TELEGRAM_MESSAGE_MAX);
}

/** Split for `sendRichMessage` (larger limit than classic sendMessage). */
export function formatTelegramRichMultipartBodies(text: string): string[] {
  return formatMultipartBodies(text, TELEGRAM_RICH_MESSAGE_MAX);
}

export async function telegramSendMessage(
  token: string,
  chatId: string,
  text: string,
  fetchFn: TelegramFetch = fetch
): Promise<void> {
  await telegramApiPost(token, "sendMessage", { chat_id: chatId, text }, fetchFn);
}

/** Send with HTML formatting; fall back to plain text when the API rejects parse (I-37). */
async function telegramSendMessageHtmlSingle(
  token: string,
  chatId: string,
  text: string,
  fetchFn: TelegramFetch = fetch
): Promise<void> {
  const html = formatTelegramHtml(text);
  if (!telegramHtmlDiffers(text, html)) {
    await telegramSendMessage(token, chatId, text, fetchFn);
    return;
  }
  try {
    await telegramApiPost(
      token,
      "sendMessage",
      { chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true },
      fetchFn
    );
  } catch {
    // Unbalanced tags after multipart split etc. — content over formatting.
    await telegramSendMessage(token, chatId, text, fetchFn);
  }
}

export async function telegramSendMessageHtml(
  token: string,
  chatId: string,
  text: string,
  fetchFn: TelegramFetch = fetch
): Promise<void> {
  const maxSingle = TELEGRAM_MESSAGE_MAX - TELEGRAM_PART_HEADER_SLACK;
  if (text.length > maxSingle) {
    for (const part of formatTelegramMultipartBodies(text)) {
      await telegramSendMessageHtmlSingle(token, chatId, part, fetchFn);
    }
    return;
  }
  await telegramSendMessageHtmlSingle(token, chatId, text, fetchFn);
}

/** Bot API 10.1+ native markdown via `sendRichMessage`. */
export async function telegramSendMessageRich(
  token: string,
  chatId: string,
  text: string,
  fetchFn: TelegramFetch = fetch
): Promise<void> {
  await telegramApiPost(
    token,
    "sendRichMessage",
    { chat_id: chatId, rich_message: { markdown: text } },
    fetchFn
  );
}

/**
 * Rich markdown → HTML sendMessage → plain text.
 * Rich is preferred for agent output (headings, lists, blockquotes without MarkdownV2 escaping).
 */
export async function telegramSendFormattedMessage(
  token: string,
  chatId: string,
  text: string,
  fetchFn: TelegramFetch = fetch,
  format: TelegramMessageFormat = "rich"
): Promise<void> {
  if (format === "plain") {
    await telegramSendMessage(token, chatId, text, fetchFn);
    return;
  }
  if (format === "rich") {
    try {
      await telegramSendMessageRich(token, chatId, text, fetchFn);
      return;
    } catch {
      /* old Bot API or unsupported markup — fall through to HTML */
    }
  }
  await telegramSendMessageHtml(token, chatId, text, fetchFn);
}

/** Rich send with cascade to 4096 multipart HTML/plain when rich or HTML fails. */
async function telegramSendRichWithFallback(
  token: string,
  chatId: string,
  text: string,
  fetchFn: TelegramFetch = fetch
): Promise<number> {
  try {
    await telegramSendMessageRich(token, chatId, text, fetchFn);
    return 1;
  } catch {
    /* fall through to classic sendMessage limits */
  }
  const parts = formatTelegramMultipartBodies(text);
  for (const part of parts) {
    try {
      await telegramSendMessageHtmlSingle(token, chatId, part, fetchFn);
    } catch {
      await telegramSendMessage(token, chatId, part, fetchFn);
    }
  }
  return parts.length;
}

/** Send text as one or more Telegram messages (same chunking as cron digest). */
export async function telegramSendLongMessage(
  token: string,
  chatId: string,
  text: string,
  fetchFn: TelegramFetch = fetch,
  opts: { html?: boolean; format?: TelegramMessageFormat } = {}
): Promise<number> {
  const format = resolveTelegramSendFormat(opts);
  if (format === "plain") {
    const bodies = formatTelegramMultipartBodies(text);
    for (const body of bodies) await telegramSendMessage(token, chatId, body, fetchFn);
    return bodies.length;
  }
  if (format === "html") {
    const bodies = formatTelegramMultipartBodies(text);
    for (const body of bodies) await telegramSendMessageHtml(token, chatId, body, fetchFn);
    return bodies.length;
  }
  const richBodies = formatTelegramRichMultipartBodies(text);
  let sent = 0;
  for (const body of richBodies) {
    sent += await telegramSendRichWithFallback(token, chatId, body, fetchFn);
  }
  return sent;
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
  dir?: string;
  /** Min ms between progress edits (tests set 0). */
  progressEditMinMs?: number;
}

/** Telegram tolerates ~1 edit/sec per chat; stay under it. */
export const TELEGRAM_PROGRESS_EDIT_MIN_MS = 1500;

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
  const dir = opts.dir ?? process.cwd();
  if (!isChatAllowed(cfg, chatId, dir)) {
    const pairing = tryRegisterPairing(dir, "telegram", chatId);
    return { handled: true, chatId, reply: pairing.message };
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
  const quickCommand = text === "/new" || isGatewaySlashCommand(text);
  const typing =
    cfg.telegramShowTyping && !quickCommand
      ? startTelegramTypingLoop(token, chatId, fetchFn)
      : null;
  const toolState: TelegramToolProgressState = { lastToolName: null, seenCallIds: new Set() };

  // One self-updating progress message per turn (I-37): first tool call sends
  // it, later calls edit it (rate-limited). Serial chain keeps send-before-edit.
  const editMinMs = opts.progressEditMinMs ?? TELEGRAM_PROGRESS_EDIT_MIN_MS;
  let progressMessageId: number | null = null;
  let lastEditAt = 0;
  let pendingLine: string | null = null;
  let progressChain: Promise<void> = Promise.resolve();

  const pushProgress = (line: string): void => {
    pendingLine = line;
    progressChain = progressChain.then(async () => {
      const next = pendingLine;
      if (next == null) return;
      try {
        if (progressMessageId == null) {
          pendingLine = null;
          const sent = await telegramApiPost<{ message_id?: number }>(
            token,
            "sendMessage",
            { chat_id: chatId, text: next },
            fetchFn
          );
          progressMessageId = sent?.message_id ?? null;
          lastEditAt = Date.now();
          if (cfg.telegramShowTyping) {
            await telegramSendChatAction(token, chatId, "typing", fetchFn);
          }
          return;
        }
        if (Date.now() - lastEditAt < editMinMs) return; // keep pendingLine for a later call
        pendingLine = null;
        await telegramApiPost(
          token,
          "editMessageText",
          { chat_id: chatId, message_id: progressMessageId, text: next },
          fetchFn
        );
        lastEditAt = Date.now();
      } catch {
        /* non-fatal UX */
      }
    });
  };

  const flushProgress = async (): Promise<void> => {
    await progressChain;
    // Final state: make sure the last tool line landed even if rate-limited.
    if (pendingLine != null && progressMessageId != null) {
      const line = pendingLine;
      pendingLine = null;
      try {
        await telegramApiPost(
          token,
          "editMessageText",
          { chat_id: chatId, message_id: progressMessageId, text: line },
          fetchFn
        );
      } catch {
        /* non-fatal UX */
      }
    }
  };

  try {
    const { reply } = await router.handleInbound(chatId, text, {
      onActivity: (activity) => {
        if (!shouldEmitTelegramToolProgress(cfg, activity, toolState)) return;
        pushProgress(formatTelegramToolProgressLine(activity));
      },
    });
    await flushProgress();
    return { handled: true, chatId, reply };
  } catch (e) {
    await flushProgress();
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
  onLog?: ServiceLogSink;
}

/** Backoff for poll failures; honors Telegram `retry after N` seconds on 429. */
/** Scopes Hermes used to register — overwrite stale menu in each. */
const TELEGRAM_COMMAND_SCOPES = [
  { type: "default" },
  { type: "all_private_chats" },
  { type: "all_group_chats" },
] as const;

/** Push csagent slash catalog to Telegram «/» menu (replaces Hermes leftovers). */
export async function syncTelegramBotCommands(
  token: string,
  fetchFn: TelegramFetch = fetch
): Promise<number> {
  const commands = gatewayTelegramBotCommands();
  for (const scope of TELEGRAM_COMMAND_SCOPES) {
    await telegramApiPost(token, "setMyCommands", { commands, scope }, fetchFn);
  }
  return commands.length;
}

export function telegramPollRetryDelayMs(
  message: string,
  consecutiveErrors: number,
  pollMs: number,
  maxBackoffMs: number
): number {
  const m = message.match(/retry after (\d+)/i);
  if (m) {
    const sec = parseInt(m[1]!, 10);
    if (Number.isFinite(sec) && sec > 0) {
      return Math.min(sec * 1000, maxBackoffMs);
    }
  }
  return Math.min(pollMs * 2 ** Math.max(0, consecutiveErrors - 1), maxBackoffMs);
}

export function startTelegramPoller(opts: TelegramPollerOptions): TelegramPoller {
  const dir = opts.dir ?? process.cwd();
  const token = telegramBotToken(opts.cfg, dir);
  if (!token) throw new Error(`telegram bot token env ${opts.cfg.telegramTokenEnv} is unset`);
  // Fail fast on corrupt tokens (postmortem 2026-06-12): hundreds of poll
  // "Not Found" errors hide the real cause — refuse to start instead.
  const tokenFmt = validateTelegramBotTokenFormat(token);
  if (!tokenFmt.ok) {
    throw new Error(
      `telegram bot token is invalid (${tokenFmt.detail}) — re-save: csagent auth telegram login --stdin (or auth history / auth restore)`
    );
  }
  const fetchFn = opts.fetchFn ?? fetch;
  const logInfo = (s: string) => emitServiceLog(s, "info", opts.onLog);
  const logError = (s: string) => emitServiceLog(s, "error", opts.onLog);
  const pollMs = opts.pollIntervalMs ?? opts.cfg.telegramPollIntervalMs;
  let offset = loadTelegramPollOffset(opts.dir ?? process.cwd());
  let running = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let consecutiveErrors = 0;
  const maxBackoffMs = 60_000;
  let lastHeartbeatLog = Date.now();
  const heartbeatMs = 15 * 60 * 1000;
  /** Per-chat serial queues: one slow turn must not block other chats or the poll loop. */
  const chatQueues = new Map<string, Promise<void>>();
  let pollTicks = 0;
  const pollAliveEvery = Math.max(20, Math.floor(60_000 / Math.max(pollMs, 500)));
  let inflightTick: Promise<void> = Promise.resolve();

  const SEND_RETRY_DELAY_MS = 1500;

  /** Agent turn already ran — retry once, then park in the outbox (I-31). */
  const deliverWithRetry = async (chatId: string, text: string, formatted: boolean): Promise<void> => {
    const format = formatted ? opts.cfg.telegramMessageFormat : "plain";
    const send = async () => {
      if (formatted) {
        await telegramSendLongMessage(token, chatId, text, fetchFn, { format });
      } else {
        await telegramSendMessage(token, chatId, text, fetchFn);
      }
    };
    try {
      await send();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logError(`[gateway] telegram send failed chat=${chatId}: ${msg}; retrying once`);
      await new Promise((r) => setTimeout(r, SEND_RETRY_DELAY_MS));
      try {
        await send();
      } catch (e2) {
        const msg2 = e2 instanceof Error ? e2.message : String(e2);
        try {
          const entry = enqueueOutbox(dir, { chatId, text, format: formatted ? format : "plain" });
          logError(`[gateway] telegram send parked in outbox chat=${chatId} id=${entry.id}: ${msg2}`);
          await sendOutboxParkAck(
            (ack) => telegramSendMessage(token, chatId, ack, fetchFn),
            logInfo,
            entry.id
          );
        } catch (e3) {
          logError(
            `[gateway] telegram reply LOST chat=${chatId}: ${msg2}; outbox failed: ${e3 instanceof Error ? e3.message : String(e3)}; replyPreview=${text.slice(0, 200)}`
          );
        }
      }
    }
  };

  /** Deliver parked messages; called from the poll loop (cheap when empty). */
  const drainParked = async (): Promise<void> => {
    try {
      const result = await drainOutbox(
        dir,
        async (entry) => {
          const format = resolveOutboxDeliveryFormat(entry);
          if (format === "plain") {
            await telegramSendLongMessage(token, entry.chatId, entry.text, fetchFn, { format: "plain" });
          } else {
            await telegramSendLongMessage(token, entry.chatId, entry.text, fetchFn, { format });
          }
        },
        {
          onDrop: (entry) =>
            logError(
              `[gateway] outbox DROP chat=${entry.chatId} attempts=${entry.attempts} preview=${entry.text.slice(0, 120)}`
            ),
        }
      );
      if (result.sent > 0 || result.dropped > 0) {
        logInfo(
          `[gateway] outbox drained sent=${result.sent} failed=${result.failed} dropped=${result.dropped} remaining=${result.remaining}`
        );
      }
    } catch (e) {
      logError(`[gateway] outbox drain error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleUpdate = async (u: TelegramUpdate): Promise<void> => {
    const result = await processTelegramUpdate(opts.cfg, opts.router, u, {
      token,
      fetchFn,
      dir: opts.dir,
    });
    if (!result.handled || !result.chatId) return;
    if (result.reply) {
      await deliverWithRetry(result.chatId, result.reply, true);
    } else if (result.error) {
      logError(`[gateway] telegram chat=${result.chatId} error: ${result.error}`);
      if (result.error === "busy" || result.error === "peer busy — previous turn still running") {
        await deliverWithRetry(result.chatId, "Still working on your previous message…", false);
      } else if (result.error === "chat not allowed") {
        await deliverWithRetry(result.chatId, "This chat is not allowlisted.", false);
      } else if (result.error === "message too long") {
        await deliverWithRetry(result.chatId, "Message too long — please shorten it.", false);
      } else {
        // Internal error details stay in the service log, not in the chat.
        await deliverWithRetry(result.chatId, "Something went wrong — check gateway logs.", false);
      }
    }
  };

  const tick = async () => {
    if (!running) return;
    let nextDelayMs = pollMs;
    await drainParked();
    try {
      const pollTimeoutSec = resolveTelegramGetUpdatesTimeoutSec(pollMs);
      const updates = await telegramGetUpdates(token, offset, pollTimeoutSec, fetchFn);
      consecutiveErrors = 0;
      pollTicks++;
      if (updates.length > 0) {
        logInfo(
          `[gateway] telegram updates=${updates.length} offset=${offset} types=${summarizeTelegramUpdateTypes(updates)}`
        );
      } else if (pollTicks % pollAliveEvery === 0) {
        logInfo(`[gateway] telegram poll alive offset=${offset}`);
      }
      if (Date.now() - lastHeartbeatLog >= heartbeatMs) {
        logInfo(`[gateway] telegram poll ok (heartbeat offset=${offset})`);
        lastHeartbeatLog = Date.now();
      }
      for (const u of updates) {
        if (!running) break;
        const chatKey = String(u.message?.chat.id ?? "-");
        const prev = chatQueues.get(chatKey) ?? Promise.resolve();
        const settled = prev
          .then(() => handleUpdate(u))
          .catch((e) => {
            logError(
              `[gateway] telegram update failed chat=${chatKey}: ${e instanceof Error ? e.message : String(e)}`
            );
          });
        chatQueues.set(chatKey, settled);
        // Ack only after this update is handled — avoid losing user messages on crash/hang.
        await settled;
        offset = Math.max(offset, u.update_id + 1);
        saveTelegramPollOffset(opts.dir ?? process.cwd(), offset);
      }
    } catch (e) {
      consecutiveErrors++;
      const msg = e instanceof Error ? e.message : String(e);
      nextDelayMs = telegramPollRetryDelayMs(msg, consecutiveErrors, pollMs, maxBackoffMs);
      logError(`[gateway] telegram poll error (#${consecutiveErrors}): ${msg}; retry in ${nextDelayMs}ms`);
    }
    if (running) {
      timer = setTimeout(() => {
        inflightTick = tick();
      }, nextDelayMs);
    }
  };

  logInfo(`[gateway] telegram long-poll started (interval=${pollMs}ms, offset=${offset})`);
  void syncTelegramBotCommands(token, fetchFn)
    .then((n) => logInfo(`[gateway] telegram setMyCommands OK (${n} cmds, ${TELEGRAM_COMMAND_SCOPES.length} scopes)`))
    .catch((e) =>
      logError(`[gateway] telegram setMyCommands failed: ${e instanceof Error ? e.message : String(e)}`)
    );
  inflightTick = tick();

  return {
    stop: async () => {
      running = false;
      if (timer) clearTimeout(timer);
      // Drain: finish the in-flight poll and all per-chat turns before the
      // caller disposes router sessions.
      await inflightTick.catch(() => {});
      await Promise.allSettled([...chatQueues.values()]);
    },
  };
}
