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
import { Store } from "./store.js";
import { safetyGate, type Confirmer } from "./safety.js";
import { loadSkills, SkillError, type Skill } from "./skills.js";
import { composePrompt, ContextRefError } from "./composePrompt.js";
import { connectAgentForSession, replayPreamble, type ConnectMode } from "./sessionConnect.js";
import { redact } from "./redact.js";
import { newId, preview, resultPreview, nowIso } from "./util.js";
import { EXIT, type ExitCode } from "./exit.js";
import type { ActivityDetail } from "./host.js";
import { consumeRunStream, formatSdkError, isAgentRotatableError } from "./sdkErrors.js";

type ChatSdk = SdkCreateLike & SdkResumeLike;

export interface AgentRotatedInfo {
  previousAgentId: string | null;
  newAgentId: string | null;
  replayTurns: number;
}

export interface ChatSessionOptions {
  sdk?: ChatSdk;
  dir?: string;
  skills?: string[];
  yesIUnderstand?: boolean;
  confirm?: Confirmer;
  interactive?: boolean;
  /** Override config model for this session. */
  model?: string;
  /** Continue an existing stored session (live resume or transcript replay). */
  resumeSessionId?: string;
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
  | { kind: "error"; message: string; fatal: boolean };

export interface TurnStats {
  durationMs: number;
  toolCalls: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ChatSession {
  sessionId: string;
  cfg: AgentConfig;
  agentId: string | null;
  connectMode: ConnectMode | "fresh";
  sendTurn(userMessage: string): Promise<TurnOutcome>;
  close(): Promise<void>;
}

async function resolveSdk(injected?: ChatSdk): Promise<ChatSdk> {
  if (injected) return injected;
  const mod = await import("@cursor/sdk");
  return mod.Agent as unknown as ChatSdk;
}

function resolveSessionTitle(store: Store, sessionId: string, userMsg: string): string {
  const existing = store.getSession(sessionId);
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
  const log = opts.onLog ?? ((s: string) => console.error(s));

  const apiKey = (process.env.CURSOR_API_KEY ?? "").trim();
  if (!apiKey) {
    return { ok: false, code: EXIT.config, message: "CURSOR_API_KEY is not set (export it in your environment)" };
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

  const store = new Store(dir, cfg.stateDir);

  let sdk: ChatSdk;
  try {
    sdk = await resolveSdk(opts.sdk);
  } catch (e) {
    store.close();
    return { ok: false, code: EXIT.software, message: "cannot load @cursor/sdk: " + redact((e as Error).message) };
  }

  let agent: AgentLike;
  let sessionId: string;
  let connectMode: ConnectMode | "fresh" = "fresh";
  let replayPrefix = "";
  let sessionCwd = cfg.cwd;

  if (opts.resumeSessionId) {
    const existing = store.getSession(opts.resumeSessionId);
    if (!existing) {
      store.close();
      return { ok: false, code: EXIT.usage, message: `session '${opts.resumeSessionId}' not found` };
    }
    sessionId = existing.id;
    sessionCwd = existing.cwd || cfg.cwd;
    try {
      const connected = await connectAgentForSession(sdk, store, existing, cfg, apiKey);
      agent = connected.agent;
      connectMode = connected.mode;
      replayPrefix = connected.replayPrefix;
      if (connected.mode === "replayed") {
        log(`[chat] resume replay session=${sessionId} (${connected.liveResumeError || "no agent id"})`);
      } else {
        log(`[chat] resume live session=${sessionId}`);
      }
    } catch (e) {
      store.close();
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
        mcpServers: cfg.mcpServers,
      });
    } catch (e) {
      store.close();
      const msg = e instanceof StartupError ? e.message : String(e);
      return { ok: false, code: EXIT.software, message: "startup failed: " + redact(msg) };
    }
    log(`[chat] agentId=${agent.agentId ?? "-"} session=${sessionId} cwd=${cfg.cwd}`);
  }

  store.upsertSession({
    id: sessionId,
    title: "chat session",
    cwd: sessionCwd,
    runtime: cfg.runtime,
    sdk_agent_id: agent.agentId ?? null,
    last_status: connectMode === "fresh" ? "created" : "resumed",
  });

  let firstTurn = true;
  const confirm: Confirmer = opts.confirm ?? (async () => false);

  const session: ChatSession = {
    sessionId,
    cfg,
    agentId: agent.agentId ?? null,
    connectMode,
    async sendTurn(userMessage: string): Promise<TurnOutcome> {
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
        sendMsg = composePrompt({
          userPrompt: msg,
          cwd: sessionCwd,
          skills: firstTurn ? skills : [],
        });
      } catch (e) {
        if (e instanceof ContextRefError) return { kind: "error", message: e.message, fatal: false };
        throw e;
      }
      if (firstTurn && replayPrefix) {
        sendMsg = replayPrefix + "Continue. New request:\n\n" + sendMsg;
      }
      const baseSendMsg = sendMsg;
      firstTurn = false;

      let attemptSendMsg = sendMsg;
      let rotated = false;

      for (;;) {
        const runId = newId("run");
        const startedAt = nowIso();
        const turnStartMs = Date.now();
        let toolCalls = 0;
        let usage: StreamUsage = {};
        let turnText = "";
        try {
          const run: RunLike = await agent.send(attemptSendMsg);
          await consumeRunStream(run, (ev) => {
            const activity = eventActivityDetail(ev);
            if (activity) {
              if (activity.phase === "call") toolCalls++;
              opts.onActivity?.(activity);
            }
            const u = parseStreamUsage(ev);
            if (u) usage = { ...usage, ...u };
            const th = eventThinkingText(ev);
            if (th) opts.onThinkingDelta?.(th);
            const t = eventText(ev);
            if (t) {
              turnText += t;
              opts.onAssistantDelta?.(t);
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
          log(`[chat] runId=${res.id ?? "-"} status=${lastStatus} tools=${toolCalls} ${stats.durationMs}ms`);
          store.recordRun({
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
          store.upsertSession({
            id: sessionId,
            title: resolveSessionTitle(store, sessionId, msg),
            cwd: sessionCwd,
            runtime: cfg.runtime,
            sdk_agent_id: agent.agentId ?? null,
            last_status: lastStatus,
          });
          if (lastStatus === "error") {
            return { kind: "error", message: "executed run failed (status=error)", fatal: false };
          }
          return { kind: "ok", status: lastStatus, assistantText: turnText, stats };
        } catch (e) {
          if (!rotated && isAgentRotatableError(e)) {
            rotated = true;
            const previousAgentId = agent.agentId ?? null;
            await disposeAgent(agent);
            agent = await createSession(sdk, {
              apiKey,
              model: cfg.model,
              cwd: sessionCwd,
              mcpServers: cfg.mcpServers,
            });
            session.agentId = agent.agentId ?? null;
            const replayTurns = store.listRuns(sessionId).slice(-10).length;
            const prefix = replayPreamble(store, sessionId);
            log(
              `[chat] agent rotated old=${previousAgentId ?? "-"} new=${agent.agentId ?? "-"} replay=${replayTurns}`
            );
            opts.onAgentRotated?.({
              previousAgentId,
              newAgentId: agent.agentId ?? null,
              replayTurns,
            });
            store.upsertSession({
              id: sessionId,
              title: resolveSessionTitle(store, sessionId, msg),
              cwd: sessionCwd,
              runtime: cfg.runtime,
              sdk_agent_id: agent.agentId ?? null,
              last_status: "agent_rotated",
            });
            attemptSendMsg = prefix
              ? prefix + "Continue. New request:\n\n" + baseSendMsg
              : baseSendMsg;
            opts.onTurnRetry?.();
            continue;
          }

          const formatted = formatSdkError(e);
          log(`[chat] turn error kind=${formatted.errorKind} ${formatted.message}`);
          store.recordRun({
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
          store.upsertSession({
            id: sessionId,
            title: resolveSessionTitle(store, sessionId, msg),
            cwd: sessionCwd,
            runtime: cfg.runtime,
            sdk_agent_id: agent.agentId ?? null,
            last_status: "error",
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
      store.close();
    },
  };

  return { ok: true, session };
}
