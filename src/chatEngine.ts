/**
 * Shared interactive chat session for readline CLI and Ink TUI.
 * Agent.create + send per turn, streaming, SQLite persistence, safety gate.
 */
import {
  loadConfig,
  ConfigError,
  applyEngineOverride,
  DEFAULT_CLAUDE_AGENT_MODEL,
  type AgentConfig,
  type EngineProvider,
  type EngineAuth,
} from "./config.js";
import {
  createSession,
  disposeAgent,
  eventText,
  eventActivityDetail,
  eventThinkingText,
  parseStreamUsage,
  sendAgentTurn,
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
import { loadSkills, scanSkillThreat, SkillError, type Skill } from "./skills.js";
import { runPreTurnHook, runPostTurnHook } from "./turnHooks.js";
import { composePrompt, ContextRefError, MemoryError } from "./composePrompt.js";
import { sessionStartMemoryBlocks } from "./memory.js";
import { autoRagMemoryBlocks } from "./autoRag.js";
import { buildPreTurnBlocks } from "./preTurn.js";
import { connectAgentForSession, replayPreamble, type ConnectMode } from "./sessionConnect.js";
import { resolveMcpServers } from "./mcpServers.js";
import { redact } from "./redact.js";
import { newId, preview, resultPreview, nowIso } from "./util.js";
import { EXIT, type ExitCode } from "./exit.js";
import type { ActivityDetail } from "./host.js";
import { consumeRunStream, formatSdkError, isAgentRotatableError } from "./sdkErrors.js";
import {
  API_KEY_HELP,
  ANTHROPIC_API_KEY_HELP,
  resolveApiKey,
  resolveAnthropicKey,
  resolveClaudeOAuthToken,
} from "./credentials.js";
import { formatRunErrorMessage, pickRunErrorDetail } from "./runErrors.js";
import { formatErrorDetail } from "./runErrorDetail.js";
import { agentLogVerbose, resolveAgentLogger } from "./agentLog.js";
import { isAgentIdle, resolveAgentIdleMs } from "./agentIdle.js";
import { buildRunLogMeta } from "./runContext.js";

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
  /** Override engine.provider for this session (--engine). */
  engine?: string;
  /** Override engine.auth for this session (--auth). */
  auth?: string;
  /** Continue an existing stored session (live resume or transcript replay). */
  resumeSessionId?: string;
  /** Owning channel (telegram, tui, cli, …) — isolates gateway from TUI. */
  channel?: SessionChannel;
  /** Cron job id when channel=cron (I-68 run log). */
  cronJob?: string;
  /** Gateway peer for cron_propose MCP (Telegram chatId). */
  gatewayPeer?: { adapter: string; chatId: string };
  onLog?: (line: string) => void;
  onAssistantDelta?: (delta: string) => void;
  onThinkingDelta?: (chunk: string) => void;
  onActivity?: (entry: ActivityDetail) => void;
  /** Fired before resending a turn after agent rotation (idle refresh or run_error). */
  onTurnRetry?: (reason?: string) => void;
  /** Fired when rotation starts — UI can show a pending state (I-13). */
  onAgentRotating?: (info: { reason: string }) => void;
  /** Fired when SDK agent is replaced inside the same irida session. */
  onAgentRotated?: (info: AgentRotatedInfo) => void;
}

export type TurnOutcome =
  | { kind: "ok"; status: string; assistantText: string; stats: TurnStats }
  | { kind: "blocked"; reason: string }
  | {
      kind: "error";
      message: string;
      fatal: boolean;
      partialAssistantText?: string;
      /** The SDK run itself failed (status=error), vs. a pre/post-run logic error. */
      runFailed?: boolean;
    };

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
  /** Record delegate/subagent output into session transcript (replay on next turns). */
  injectContext(userLabel: string, assistantText: string): Promise<void>;
  close(): Promise<void>;
}

async function resolveSdk(
  provider: EngineProvider,
  authMode: EngineAuth,
  injected?: ChatSdk
): Promise<ChatSdk> {
  if (injected) return injected;
  if (provider === "claude-agent") {
    const { createClaudeAgentSdk } = await import("./engines/claudeAgentSdk.js");
    return createClaudeAgentSdk({ authMode }) as unknown as ChatSdk;
  }
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

  let cfg: AgentConfig;
  try {
    cfg = loadConfig(dir);
    cfg = applyEngineOverride(cfg, opts.engine, opts.auth);
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

  const provider = cfg.engine.provider;
  const authMode: EngineAuth = provider === "claude-agent" ? (cfg.engine.auth ?? "api-key") : "api-key";

  let apiKey = "";
  if (provider === "cursor") {
    apiKey = resolveApiKey(dir).key;
    if (!apiKey) return { ok: false, code: EXIT.config, message: API_KEY_HELP };
  } else if (authMode === "account") {
    // Account mode tolerates an empty token (falls back to the `claude login` session).
    apiKey = resolveClaudeOAuthToken(dir).key;
  } else {
    apiKey = resolveAnthropicKey(dir).key;
    if (!apiKey) return { ok: false, code: EXIT.config, message: ANTHROPIC_API_KEY_HELP };
  }

  const defaultModel =
    provider === "claude-agent" ? (cfg.engine.model ?? DEFAULT_CLAUDE_AGENT_MODEL) : cfg.model;
  const activeModel = (opts.model ?? defaultModel).trim();
  if (!activeModel) {
    return { ok: false, code: EXIT.config, message: "model must be a non-empty string" };
  }
  cfg = { ...cfg, model: activeModel };

  const mcpServers = resolveMcpServers(cfg, dir, {
    gatewayChatId: opts.gatewayPeer?.chatId,
    gatewayAdapter: opts.gatewayPeer?.adapter,
  });

  let skills: Skill[] = [];
  if (opts.skills?.length) {
    try {
      skills = loadSkills(dir, cfg.skillsPath, opts.skills, {
        allowUnsafe: cfg.skillPolicy?.allowUnsafe,
      });
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
    sdk = await resolveSdk(provider, authMode, opts.sdk);
  } catch (e) {
    await store.close();
    const pkg = provider === "claude-agent" ? "@anthropic-ai/claude-agent-sdk" : "@cursor/sdk";
    return { ok: false, code: EXIT.software, message: `cannot load ${pkg}: ` + redact((e as Error).message) };
  }

  let agent: AgentLike;
  let sessionId: string;
  let connectMode: ConnectMode | "fresh" = "fresh";
  let replayPrefix = "";
  let sessionCwd = opts.cwd ?? cfg.cwd;
  let sessionChannel = opts.channel ?? "";
  const sessionCronJob = opts.cronJob?.trim() ?? "";
  let lastAgentTouchAt = Date.now();
  /** True when the previous agent was disposed but its replacement failed to start. */
  let agentBroken = false;

  if (opts.resumeSessionId) {
    const existing = await store.getSession(opts.resumeSessionId);
    if (!existing) {
      await store.close();
      return { ok: false, code: EXIT.usage, message: `session '${opts.resumeSessionId}' not found` };
    }
    const resumedAt = Date.parse(existing.updated_at);
    if (Number.isFinite(resumedAt)) lastAgentTouchAt = resumedAt;
    if (!sessionAllowedForChannel(existing, opts.channel, gatewayPeerIds)) {
      await store.close();
      return {
        ok: false,
        code: EXIT.usage,
        message: sessionChannelConflictMessage(existing),
      };
    }
    const sessionEngine = (existing.engine ?? "").trim() || "cursor";
    if (sessionEngine !== provider) {
      await store.close();
      return {
        ok: false,
        code: EXIT.usage,
        message: `session '${opts.resumeSessionId}' was created with engine '${sessionEngine}', but the active engine is '${provider}'. Set engine.provider to '${sessionEngine}' or start a new session.`,
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
    engine: provider,
  });

  // Live resume keeps SDK context — skip skills/onStart reinjection (gateway restart post-mortem 2026-06-13).
  let firstTurn = connectMode !== "resumed";
  const confirm: Confirmer = opts.confirm ?? (async () => false);

  const runLogMeta = () =>
    buildRunLogMeta({
      channel: sessionChannel,
      cronJob: sessionCronJob || undefined,
      cwd: sessionCwd,
    });

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

      let sendMsg: string;
      const isFirstTurn = firstTurn;
      try {
        const { taskText, blocks: preTurnBlocks } = await buildPreTurnBlocks({
          dir,
          cfg,
          rawMessage: msg,
          includeProfile: isFirstTurn,
        });
        const sessionMemoryBlocks =
          isFirstTurn ? await sessionStartMemoryBlocks(dir, cfg) : [];
        const autoRagBlocks = await autoRagMemoryBlocks(dir, taskText, cfg);
        sendMsg = await composePrompt({
          userPrompt: taskText,
          cwd: sessionCwd,
          dir,
          skills: isFirstTurn ? skills : [],
          sessionMemoryBlocks,
          preTurnBlocks,
          autoRagBlocks,
        });
      } catch (e) {
        if (e instanceof ContextRefError) return { kind: "error", message: e.message, fatal: false };
        if (e instanceof MemoryError) return { kind: "error", message: e.message, fatal: false };
        throw e;
      }
      // Profile/skills/onStart apply once per session — consume before gate so blocked first turns do not re-inject.
      firstTurn = false;

      const hookEnv = {
        prompt: msg,
        sessionId,
        channel: sessionChannel,
        cwd: sessionCwd,
      };
      if (cfg.hooks?.preTurn) {
        const pre = runPreTurnHook(cfg.hooks.preTurn, hookEnv);
        if (!pre.allowed) {
          return { kind: "blocked", reason: pre.reason ?? "preTurn hook denied" };
        }
        if (pre.appendStdout) {
          sendMsg = `${sendMsg}\n\n[hook:preTurn]\n${pre.appendStdout}`;
        }
      }

      // Gate the composed prompt (message + expanded @file/@memory refs), not
      // the replay transcript — history was already gated when first sent.
      const gate = await safetyGate({
        prompt: sendMsg,
        interactive,
        confirm,
        override: opts.yesIUnderstand,
      });
      if (!gate.allowed) {
        return { kind: "blocked", reason: gate.reason };
      }

      // Composed prompt without any replay prefix — rotation regenerates its own.
      const coreSendMsg = sendMsg;
      if (isFirstTurn && replayPrefix) {
        sendMsg = replayPrefix + "Continue. New request:\n\n" + sendMsg;
      }
      const baseSendMsg = sendMsg;

      let attemptSendMsg = sendMsg;
      let rotated = false;

      log(
        `[chat] sendTurn session=${sessionId} agent=${agent.agentId ?? "-"} userChars=${msg.length} composedChars=${sendMsg.length} replayPrefixChars=${replayPrefix.length}`
      );

      /**
       * Replace the SDK agent. Does not consume the per-turn retry budget.
       *
       * `preserveOldOnFailure` (idle refresh): create the replacement BEFORE
       * disposing the current agent, so a transient createSession failure leaves
       * the live agent intact and the turn proceeds on it instead of being
       * stranded on a disposed handle (I-111). Error/recover rotations dispose
       * first — their old handle is already known-bad.
       */
      const rotateAgent = async (
        reason: string,
        rotateOpts: { preserveOldOnFailure?: boolean } = {}
      ): Promise<boolean> => {
        const previousAgentId = agent.agentId ?? null;
        const previousAgent = agent;
        log(`[chat] rotate start reason=${reason} oldAgent=${previousAgentId ?? "-"}`);
        opts.onAgentRotating?.({ reason });
        if (!rotateOpts.preserveOldOnFailure) await disposeAgent(previousAgent);
        let next: AgentLike;
        try {
          next = await createSession(sdk, {
            apiKey,
            model: cfg.model,
            cwd: sessionCwd,
            mcpServers: mcpServers,
          });
        } catch (e) {
          const m = e instanceof StartupError ? e.message : String(e);
          if (rotateOpts.preserveOldOnFailure) {
            // Old agent is still alive — keep it and let the turn run normally.
            log(`[chat] idle refresh failed, keeping current agent reason=${reason} ${redact(m)}`);
            return false;
          }
          // The old agent is already disposed; remember that so the next turn
          // retries createSession instead of sending into a dead handle.
          agentBroken = true;
          log(`[chat] rotate failed reason=${reason} ${redact(m)}`);
          return false;
        }
        if (rotateOpts.preserveOldOnFailure) await disposeAgent(previousAgent);
        agentBroken = false;
        agent = next;
        lastAgentTouchAt = Date.now();
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
          ? prefix + "Continue. New request:\n\n" + coreSendMsg
          : coreSendMsg;
        opts.onTurnRetry?.(reason);
        return true;
      };

      /** Error-path rotation: at most one retry per turn. */
      const tryRotateAgent = async (reason: string): Promise<boolean> => {
        if (rotated) return false;
        rotated = true;
        return rotateAgent(reason);
      };

      if (agentBroken) {
        if (!(await rotateAgent("recover_failed_rotation"))) {
          return {
            kind: "error",
            message: "agent unavailable (SDK session create failed); try again",
            fatal: false,
          };
        }
      } else if (isAgentIdle(lastAgentTouchAt)) {
        log(
          `[chat] idle refresh due lastTouch=${lastAgentTouchAt} idleMs=${resolveAgentIdleMs()} agoMs=${Date.now() - lastAgentTouchAt}`
        );
        // Proactive, best-effort refresh: must not consume the error-retry budget
        // and must not strand the turn if the SDK is briefly unreachable (I-111) —
        // on failure the live agent is kept and the turn proceeds on it.
        await rotateAgent(`idle_ttl ${resolveAgentIdleMs()}ms`, { preserveOldOnFailure: true });
      }

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
          const run: RunLike = await sendAgentTurn(agent, attemptSendMsg, cfg.model, {
            onDelta: ({ update }) => {
              const u = parseStreamUsage(update);
              if (u) usage = { ...usage, ...u };
            },
          });
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
          const runErrorDetail =
            lastStatus === "error"
              ? formatErrorDetail([
                  pickRunErrorDetail(res),
                  `tools=${toolCalls}`,
                  `partialChars=${turnText.length}`,
                ])
              : null;
          await store.recordRun({
            id: runId,
            session_id: sessionId,
            sdk_agent_id: agent.agentId ?? null,
            sdk_run_id: res.id ?? null,
            prompt_preview: preview(msg),
            result_preview: resultPreview(turnText),
            status: lastStatus,
            error_kind: lastStatus === "error" ? "run_error" : null,
            error_detail: runErrorDetail,
            started_at: startedAt,
            finished_at: nowIso(),
            cwd: sessionCwd,
            runtime: cfg.runtime,
            model: cfg.model,
            input_tokens: usage.inputTokens ?? null,
            output_tokens: usage.outputTokens ?? null,
            ...runLogMeta(),
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
              runFailed: true,
            };
          }
          log(`[chat] sendTurn ok status=${lastStatus} assistantChars=${turnText.length}`);
          lastAgentTouchAt = Date.now();
          if (cfg.hooks?.postTurn) {
            runPostTurnHook(cfg.hooks.postTurn, hookEnv, log);
          }
          return { kind: "ok", status: lastStatus, assistantText: turnText, stats };
        } catch (e) {
          const formatted = formatSdkError(e);
          const rotateReason = `exception kind=${formatted.errorKind} ${formatted.message}`;
          log(`[chat] sendTurn error kind=${formatted.errorKind} ${formatted.message}`);
          // Record the failed attempt before any retry so transcript/replay keeps it.
          await store.recordRun({
            id: runId,
            session_id: sessionId,
            sdk_agent_id: agent.agentId ?? null,
            sdk_run_id: null,
            prompt_preview: preview(msg),
            result_preview: resultPreview(turnText),
            status: "error",
            error_kind: formatted.errorKind,
            error_detail: formatErrorDetail([formatted.message]),
            started_at: startedAt,
            finished_at: nowIso(),
            cwd: sessionCwd,
            runtime: cfg.runtime,
            model: cfg.model,
            ...runLogMeta(),
          });
          if (isAgentRotatableError(e) && (await tryRotateAgent(rotateReason))) continue;

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
            partialAssistantText: turnText.trim() ? turnText : undefined,
          };
        }
      }
    },
    async injectContext(userLabel: string, assistantText: string): Promise<void> {
      const label = userLabel.trim();
      const body = assistantText.trim();
      if (!label || !body) return;
      const runId = newId("run");
      await store.recordRun({
        id: runId,
        session_id: sessionId,
        sdk_agent_id: agent.agentId ?? null,
        sdk_run_id: null,
        prompt_preview: preview(label),
        result_preview: resultPreview(body),
        status: "injected",
        error_kind: null,
        started_at: nowIso(),
        finished_at: nowIso(),
        cwd: sessionCwd,
        runtime: cfg.runtime,
        model: cfg.model,
        ...runLogMeta(),
      });
      lastAgentTouchAt = Date.now();
      log(`[chat] injectContext session=${sessionId} labelChars=${label.length} bodyChars=${body.length}`);
    },
    async close(): Promise<void> {
      await disposeAgent(agent);
      await store.close();
    },
  };

  return { ok: true, session };
}
