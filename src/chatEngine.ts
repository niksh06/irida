/**
 * Shared interactive chat session for readline CLI and Ink TUI.
 * Agent.create + send per turn, streaming, SQLite persistence, safety gate.
 */
import { loadConfig, ConfigError, type AgentConfig } from "./config.js";
import {
  createSession,
  disposeAgent,
  eventText,
  StartupError,
  type AgentLike,
  type RunLike,
  type SdkCreateLike,
} from "./host.js";
import { Store } from "./store.js";
import { safetyGate, type Confirmer } from "./safety.js";
import { loadSkills, SkillError, type Skill } from "./skills.js";
import { composePrompt, ContextRefError } from "./composePrompt.js";
import { redact } from "./redact.js";
import { newId, preview, resultPreview, nowIso } from "./util.js";
import { EXIT, type ExitCode } from "./exit.js";

export interface ChatSessionOptions {
  sdk?: SdkCreateLike;
  dir?: string;
  skills?: string[];
  yesIUnderstand?: boolean;
  confirm?: Confirmer;
  interactive?: boolean;
  onLog?: (line: string) => void;
  onAssistantDelta?: (delta: string) => void;
}

export type TurnOutcome =
  | { kind: "ok"; status: string; assistantText: string }
  | { kind: "blocked"; reason: string }
  | { kind: "error"; message: string; fatal: boolean };

export interface ChatSession {
  sessionId: string;
  cfg: AgentConfig;
  agentId: string | null;
  sendTurn(userMessage: string): Promise<TurnOutcome>;
  close(): Promise<void>;
}

async function resolveSdk(injected?: SdkCreateLike): Promise<SdkCreateLike> {
  if (injected) return injected;
  const mod = await import("@cursor/sdk");
  return mod.Agent as unknown as SdkCreateLike;
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
  const sessionId = newId("sess");

  let sdk: SdkCreateLike;
  try {
    sdk = await resolveSdk(opts.sdk);
  } catch (e) {
    store.close();
    return { ok: false, code: EXIT.software, message: "cannot load @cursor/sdk: " + redact((e as Error).message) };
  }

  let agent: AgentLike;
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

  let firstTurn = true;
  log(`[chat] agentId=${agent.agentId ?? "-"} session=${sessionId} cwd=${cfg.cwd}`);
  store.upsertSession({
    id: sessionId,
    title: "chat session",
    cwd: cfg.cwd,
    runtime: cfg.runtime,
    sdk_agent_id: agent.agentId ?? null,
    last_status: "created",
  });

  const confirm: Confirmer =
    opts.confirm ??
    (async () => false);

  const session: ChatSession = {
    sessionId,
    cfg,
    agentId: agent.agentId ?? null,
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
          cwd: cfg.cwd,
          skills: firstTurn ? skills : [],
        });
      } catch (e) {
        if (e instanceof ContextRefError) return { kind: "error", message: e.message, fatal: false };
        throw e;
      }
      firstTurn = false;

      const runId = newId("run");
      const startedAt = nowIso();
      try {
        const run: RunLike = await agent.send(sendMsg);
        let turnText = "";
        if (typeof run.stream === "function") {
          for await (const ev of run.stream()) {
            const t = eventText(ev);
            if (t) {
              turnText += t;
              opts.onAssistantDelta?.(t);
            }
          }
        }
        const res = await run.wait();
        const lastStatus = String(res.status);
        log(`[chat] runId=${res.id ?? "-"} status=${lastStatus}`);
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
          cwd: cfg.cwd,
          runtime: cfg.runtime,
          model: cfg.model,
        });
        store.upsertSession({
          id: sessionId,
          title: "chat session",
          cwd: cfg.cwd,
          runtime: cfg.runtime,
          sdk_agent_id: agent.agentId ?? null,
          last_status: lastStatus,
        });
        if (lastStatus === "error") {
          return { kind: "error", message: "executed run failed (status=error)", fatal: false };
        }
        return { kind: "ok", status: lastStatus, assistantText: turnText };
      } catch (e) {
        const msg = e instanceof StartupError ? redact(e.message) : redact((e as Error).message);
        return { kind: "error", message: msg, fatal: true };
      }
    },
    async close(): Promise<void> {
      await disposeAgent(agent);
      store.close();
    },
  };

  return { ok: true, session };
}
