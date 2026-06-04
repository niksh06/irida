/**
 * Shared interactive chat session for readline CLI and Ink TUI.
 * Agent.create + send per turn, streaming, SQLite persistence, safety gate.
 */
import { loadConfig, ConfigError, type AgentConfig } from "./config.js";
import {
  createSession,
  disposeAgent,
  eventText,
  eventActivityDetail,
  eventThinkingText,
  parseStreamUsage,
  StartupError,
  type AgentLike,
  type RunLike,
  type SdkCreateLike,
  type SdkResumeLike,
  type StreamUsage,
} from "./host.js";
import { createStore, type IStore } from "./store.js";
import {
  sessionAllowedForChannel,
  sessionChannelConflictMessage,
  type SessionChannel,
} from "./sessionChannel.js";
import { loadGatewayPeers } from "./gatewayPeers.js";
import { safetyGate, type Confirmer } from "./safety.js";
import { loadSkills, SkillError, type Skill } from "./skills.js";
import { composePrompt, ContextRefError, MemoryError } from "./composePrompt.js";
import { sessionStartMemoryBlocks } from "./memory.js";
import { connectAgentForSession, replayPreamble, type ConnectMode } from "./sessionConnect.js";
import { resolveMcpServers } from "./mcpServers.js";
import { redact } from "./redact.js";
import { newId, preview, resultPreview, nowIso } from "./util.js";
import { EXIT, type ExitCode } from "./exit.js";
import type { ActivityDetail } from "./host.js";
import { consumeRunStream, formatSdkError, isAgentRotatableError } from "./sdkErrors.js";
import { API_KEY_HELP, resolveApiKey } from "./credentials.js";
import { formatRunErrorMessage, pickRunErrorDetail } from "./runErrors.js";
import { agentLogVerbose, resolveAgentLogger } from "./agentLog.js";

type ChatSdk = SdkCreateLike & SdkResumeLike;

export interface AgentRotatedInfo {
  previousAgentId: string | null;
  newAgentId: string | null;
  replayTurns: number;
  /** Why rotation happened (SDK run_error, stale handle, …). */
  reason?: string;
}

export interface ChatSessionOptions {
  sdk?: ChatSdk;
  dir?: string;
  /** Agent working directory (defaults to config cwd). */
  cwd?: string;
  skills?: string[];
  yesIUnderstand?: boolean;
  confirm?: Confirmer;
  interactive?: boolean;
  /** Override config model for this session. */
  model?: string;
  /** Continue an existing stored session (live resume or transcript replay). */
  resumeSessionId?: string;
  /** Owning channel (telegram, tui, cli, …) — isolates gateway from TUI. */
  channel?: SessionChannel;
  onLog?: (line: string) => void;
  onAssistantDelta?: (delta: string) => void;
  onThinkingDelta?: (chunk: string) => void;
  onActivity?: (entry: ActivityDetail) => void;
  /** Fired once before retrying a turn after in-session agent rotation. */
  onTurnRetry?: () => void;
  /** Fired when SDK agent is replaced inside the same csagent session. */
  onAgentRotated?: (info: AgentRotatedInfo) => void;
}

export type TurnOutcome =
  | { kind: "ok"; status: string; assistantText: string; stats: TurnStats }
  | { kind: "blocked"; reason: string }
  | { kind: "error"; message: string; fatal: boolean; partialAssistantText?: string };

export interface TurnStats {
  durationMs: number;
  toolCalls: number;
  inputTokens?: number;
  outputTokens?: number;
}

/** Per-turn hooks (gateway Telegram UX overrides session-level callbacks). */
export interface TurnHooks {
  onActivity?: (entry: ActivityDetail) => void;
  onAssistantDelta?: (delta: string) => void;
  onThinkingDelta?: (chunk: string) => void;
}

export interface ChatSession {
  sessionId: string;
  cfg: AgentConfig;
  agentId: string | null;
  connectMode: ConnectMode | "fresh";
  sendTurn(userMessage: string, hooks?: TurnHooks): Promise<TurnOutcome>;
  close(): Promise<void>;
}

async function resolveSdk(injected?: ChatSdk): Promise<ChatSdk> {
  if (injected) return injected;
  const mod = await import("@cursor/sdk");
  return mod.Agent as unknown as ChatSdk;
}

async function resolveSessionTitle(store: IStore, sessionId: string, userMsg: string): Promise<string> {
  const existing = await store.getSession(sessionId);
  const t = existing?.title?.trim() ?? "";
  if (t && t !== "chat session") return t;
  return preview(userMsg, 60);
}

export type OpenChatResult =
  | { ok: true; session: ChatSession }
  | { ok: false; code: ExitCode; message: string };

export async function openChatSession(opts: ChatSessionOptions = {}): Promise<OpenChatResult> {
  const dir = opts.dir ?? process.cwd();
  const interactive = opts.interactive ?? true;
  const log = resolveAgentLogger({ component: "chat", onLog: opts.onLog });

  const { key: apiKey } = resolveApiKey(dir);
  if (!apiKey) {
    return { ok: false, code: EXIT.config, message: API_KEY_HELP };
  }

  let cfg: AgentConfig;
  try {
    cfg = loadConfig(dir);
  } catch (e) {
    return {
      ok: false,
      code: EXIT.config,
      message: e instanceof ConfigError ? e.message : String(e),
    };
  }
  if (cfg.runtime === "cloud" && !cfg.safety.allowCloud) {
    return { ok: false, code: EXIT.config, message: "cloud runtime requires safety.allowCloud=true (MVP is local-first)" };
  }

  const activeModel = (opts.model ?? cfg.model).trim();
  if (!activeModel) {
    return { ok: false, code: EXIT.config, message: "model must be a non-empty string" };
  }
  cfg = { ...cfg, model: activeModel };

  const mcpServers = resolveMcpServers(cfg, dir);

  let skills: Skill[] = [];
  if (opts.skills?.length) {
    try {
      skills = loadSkills(dir, cfg.skillsPath, opts.skills);
    } catch (e) {
      return {
        ok: false,
        code: EXIT.usage,
        message: e instanceof SkillError ? e.message : String(e),
      };
    }
  }

  const store = createStore(dir, cfg.stateDir);
  const gatewayPeerIds = new Set(Object.values(loadGatewayPeers(dir).peers));

  let sdk: ChatSdk;
  try {
    sdk = await resolveSdk(opts.sdk);
  } catch (e) {
    await store.close();
    return { ok: false, code: EXIT.software, message: "cannot load @cursor/sdk: " + redact((e as Error).message) };
  }

  let agent: AgentLike;
  let sessionId: string;
  let connectMode: ConnectMode | "fresh" = "fresh";
  let replayPrefix = "";
  let sessionCwd = opts.cwd ?? cfg.cwd;
  let sessionChannel = opts.channel ?? "";

  if (opts.resumeSessionId) {
    const existing = await store.getSession(opts.resumeSessionId);
    if (!existing) {
      await store.close();
      return { ok: false, code: EXIT.usage, message: `session '${opts.resumeSessionId}' not found` };
    }
    if (!sessionAllowedForChannel(existing, opts.channel, gatewayPeerIds)) {
      await store.close();
      return {
        ok: false,
        code: EXIT.usage,
        message: sessionChannelConflictMessage(existing),
      };
    }
    sessionId = existing.id;
    sessionCwd = existing.cwd || cfg.cwd;
    sessionChannel = existing.channel?.trim() || opts.channel || "";
    try {
      const connected = await connectAgentForSession(sdk, store, existing, cfg, apiKey, mcpServers);
      agent = connected.agent;
      connectMode = connected.mode;
      replayPrefix = connected.replayPrefix;
      if (connected.mode === "replayed") {
        log(`[chat] resume replay session=${sessionId} (${connected.liveResumeError || "no agent id"})`);
      } else {
        log(`[chat] resume live session=${sessionId}`);
      }
    } catch (e) {
      await store.close();
      const msg = e instanceof StartupError ? e.message : String(e);
      return { ok: false, code: EXIT.software, message: "resume failed: " + redact(msg) };
    }
  } else {
    sessionId = newId("sess");
    try {
      agent = await createSession(sdk, {
        apiKey,
        model: cfg.model,
        cwd: cfg.cwd,
        mcpServers,
      });
    } catch (e) {
      await store.close();
      const msg = e instanceof StartupError ? e.message : String(e);
      return { ok: false, code: EXIT.software, message: "startup failed: " + redact(msg) };
    }
    log(`[chat] agentId=${agent.agentId ?? "-"} session=${sessionId} cwd=${cfg.cwd}`);
  }

  await store.upsertSession({
    id: sessionId,
    title: "chat session",
    cwd: sessionCwd,
    runtime: cfg.runtime,
    sdk_agent_id: agent.agentId ?? null,
    last_status: connectMode === "fresh" ? "created" : "resumed",
    channel: sessionChannel,
  });

  let firstTurn = true;
  const confirm: Confirmer = opts.confirm ?? (async () => false);

  const session: ChatSession = {
    sessionId,
    cfg,
    agentId: agent.agentId ?? null,
    connectMode,
    async sendTurn(userMessage: string, turnHooks?: TurnHooks): Promise<TurnOutcome> {
      const onActivity = turnHooks?.onActivity ?? opts.onActivity;
      const onAssistantDelta = turnHooks?.onAssistantDelta ?? opts.onAssistantDelta;
      const onThinkingDelta = turnHooks?.onThinkingDelta ?? opts.onThinkingDelta;
      const msg = userMessage.trim();
      if (!msg) return { kind: "error", message: "empty message", fatal: false };

      const gate = await safetyGate({
        prompt: msg,
        interactive,
        confirm,
        override: opts.yesIUnderstand,
      });
      if (!gate.allowed) {
        return { kind: "blocked", reason: gate.reason };
      }

      let sendMsg: string;
      try {
        const sessionMemoryBlocks =
          firstTurn ? await sessionStartMemoryBlocks(dir, cfg) : [];
        sendMsg = await composePrompt({
          userPrompt: msg,
          cwd: sessionCwd,
          dir,
          skills: firstTurn ? skills : [],
          sessionMemoryBlocks,
        });
      } catch (e) {
        if (e instanceof ContextRefError) return { kind: "error", message: e.message, fatal: false };
        if (e instanceof MemoryError) return { kind: "error", message: e.message, fatal: false };
        throw e;
      }
      if (firstTurn && replayPrefix) {
        sendMsg = replayPrefix + "Continue. New request:\n\n" + sendMsg;
      }
      const baseSendMsg = sendMsg;
      firstTurn = false;

      let attemptSendMsg = sendMsg;
      let rotated = false;

      log(
        `[chat] sendTurn session=${sessionId} agent=${agent.agentId ?? "-"} userChars=${msg.length} composedChars=${sendMsg.length} replayPrefixChars=${replayPrefix.length}`
      );

      const tryRotateAgent = async (reason: string): Promise<boolean> => {
        if (rotated) return false;
        rotated = true;
        const previousAgentId = agent.agentId ?? null;
        log(`[chat] rotate start reason=${reason} oldAgent=${previousAgentId ?? "-"}`);
        await disposeAgent(agent);
        agent = await createSession(sdk, {
          apiKey,
          model: cfg.model,
          cwd: sessionCwd,
          mcpServers: mcpServers,
        });
        session.agentId = agent.agentId ?? null;
        const replayRuns = Math.min(4, (await store.listRuns(sessionId)).length);
        const prefix = await replayPreamble(store, sessionId, replayRuns, 12_000);
        log(
          `[chat] rotate done reason=${reason} old=${previousAgentId ?? "-"} new=${agent.agentId ?? "-"} replayRuns=${replayRuns} replayPrefixChars=${prefix.length} basePromptChars=${baseSendMsg.length}`
        );
        opts.onAgentRotated?.({
          previousAgentId,
          newAgentId: agent.agentId ?? null,
          replayTurns: replayRuns,
          reason,
        });
        await store.upsertSession({
          id: sessionId,
          title: await resolveSessionTitle(store, sessionId, msg),
          cwd: sessionCwd,
          runtime: cfg.runtime,
          sdk_agent_id: agent.agentId ?? null,
          last_status: "agent_rotated",
          channel: sessionChannel,
        });
        attemptSendMsg = prefix
          ? prefix + "Continue. New request:\n\n" + baseSendMsg
          : baseSendMsg;
        opts.onTurnRetry?.();
        return true;
      };

      for (;;) {
        const runId = newId("run");
        const startedAt = nowIso();
        const turnStartMs = Date.now();
        let toolCalls = 0;
        let usage: StreamUsage = {};
        let turnText = "";
        const attempt = rotated ? 2 : 1;
        log(
          `[chat] run send attempt=${attempt} runId=${runId} promptChars=${attemptSendMsg.length} agent=${agent.agentId ?? "-"}`
        );
        try {
          const run: RunLike = await agent.send(attemptSendMsg);
          await consumeRunStream(run, (ev) => {
            const activity = eventActivityDetail(ev);
            if (activity) {
              if (activity.phase === "call") toolCalls++;
              if (agentLogVerbose() && activity.phase === "call") {
                const cmd = activity.command?.trim();
                log(
                  `[chat] tool call #${toolCalls} ${activity.toolName ?? activity.label}${cmd ? ` cmd=${preview(cmd, 120)}` : ""}`
                );
              }
              onActivity?.(activity);
            }
            const u = parseStreamUsage(ev);
            if (u) usage = { ...usage, ...u };
            const th = eventThinkingText(ev);
            if (th) onThinkingDelta?.(th);
            const t = eventText(ev);
            if (t) {
              turnText += t;
              onAssistantDelta?.(t);
            }
          });
          const res = await run.wait();
          const lastStatus = String(res.status);
          const stats: TurnStats = {
            durationMs: Date.now() - turnStartMs,
            toolCalls,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          };
          log(
            `[chat] run done sdkRun=${res.id ?? "-"} status=${lastStatus} tools=${toolCalls} assistantChars=${turnText.length} ${stats.durationMs}ms in=${usage.inputTokens ?? "-"} out=${usage.outputTokens ?? "-"}`
          );
          await store.recordRun({
            id: runId,
            session_id: sessionId,
            sdk_agent_id: agent.agentId ?? null,
            sdk_run_id: res.id ?? null,
            prompt_preview: preview(msg),
            result_preview: resultPreview(turnText),
            status: lastStatus,
            error_kind: lastStatus === "error" ? "run_error" : null,
            started_at: startedAt,
            finished_at: nowIso(),
            cwd: sessionCwd,
            runtime: cfg.runtime,
            model: cfg.model,
          });
          await store.upsertSession({
            id: sessionId,
            title: await resolveSessionTitle(store, sessionId, msg),
            cwd: sessionCwd,
            runtime: cfg.runtime,
            sdk_agent_id: agent.agentId ?? null,
            last_status: lastStatus,
            channel: sessionChannel,
          });
          if (lastStatus === "error") {
            const detail = pickRunErrorDetail(res);
            const rotateReason = [
              "run_error",
              `status=${lastStatus}`,
              detail ? `detail=${detail}` : "",
              `tools=${toolCalls}`,
              `partialChars=${turnText.length}`,
            ]
              .filter(Boolean)
              .join(" ");
            if (await tryRotateAgent(rotateReason)) continue;
            const failed = formatRunErrorMessage({ res, toolCalls, turnText });
            log(`[chat] sendTurn failed (no retry) ${failed.message}`);
            return {
              kind: "error",
              message: failed.message,
              fatal: false,
              partialAssistantText: failed.partialAssistantText,
            };
          }
          log(`[chat] sendTurn ok status=${lastStatus} assistantChars=${turnText.length}`);
          return { kind: "ok", status: lastStatus, assistantText: turnText, stats };
        } catch (e) {
          const formatted = formatSdkError(e);
          const rotateReason = `exception kind=${formatted.errorKind} ${formatted.message}`;
          if (isAgentRotatableError(e) && (await tryRotateAgent(rotateReason))) continue;

          log(`[chat] sendTurn error kind=${formatted.errorKind} ${formatted.message}`);
          await store.recordRun({
            id: runId,
            session_id: sessionId,
            sdk_agent_id: agent.agentId ?? null,
            sdk_run_id: null,
            prompt_preview: preview(msg),
            result_preview: resultPreview(turnText),
            status: "error",
            error_kind: formatted.errorKind,
            started_at: startedAt,
            finished_at: nowIso(),
            cwd: sessionCwd,
            runtime: cfg.runtime,
            model: cfg.model,
          });
          await store.upsertSession({
            id: sessionId,
            title: await resolveSessionTitle(store, sessionId, msg),
            cwd: sessionCwd,
            runtime: cfg.runtime,
            sdk_agent_id: agent.agentId ?? null,
            last_status: "error",
            channel: sessionChannel,
          });
          return {
            kind: "error",
            message: formatted.message,
            fatal: !formatted.recoverable,
          };
        }
      }
    },
    async close(): Promise<void> {
      await disposeAgent(agent);
      await store.close();
    },
  };

  return { ok: true, session };
}
