/**
 * `cursor-agent resume <session-id> "<prompt>"` — continue a stored session
 * (issue 011). Cursor SDK local agents are not reliably durable after the
 * process exits, so resume has two paths:
 *
 *   1. Live resume: `Agent.resume(sdk_agent_id)` when it still works.
 *   2. Transcript replay (fallback): when live resume is unavailable or has no
 *      agent id, create a FRESH agent and prepend the stored (redacted)
 *      transcript so context carries over. Lossy but durable.
 *
 * One-shot follow-up for MVP. Destructive prompts denied unless
 * --yes-i-understand. Skills may be injected.
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
import { disposeAgent, eventText, sendAgentTurn, StartupError, type RunLike, type SdkResumeLike, type SdkCreateLike } from "./host.js";
import { createStore } from "./store.js";
import { safetyGate } from "./safety.js";
import { loadSkills, SkillError } from "./skills.js";
import { resolveMcpServers } from "./mcpServers.js";
import { composePrompt, ContextRefError, MemoryError } from "./composePrompt.js";
import { sessionStartMemoryBlocks } from "./memory.js";
import { autoRagMemoryBlocks } from "./autoRag.js";
import { buildPreTurnBlocks } from "./preTurn.js";
import { redact } from "./redact.js";
import { newId, preview, resultPreview, nowIso } from "./util.js";
import { pickRunErrorDetail } from "./runErrors.js";
import { formatErrorDetail } from "./runErrorDetail.js";
import { EXIT, type ExitCode } from "./exit.js";
import { connectAgentForSession } from "./sessionConnect.js";
import {
  API_KEY_HELP,
  ANTHROPIC_API_KEY_HELP,
  resolveApiKey,
  resolveAnthropicKey,
  resolveClaudeOAuthToken,
} from "./credentials.js";

type ResumeSdk = SdkResumeLike & SdkCreateLike;

export interface ResumeOptions {
  sdk?: ResumeSdk;
  dir?: string;
  write?: (s: string) => void;
  yesIUnderstand?: boolean;
  skills?: string[];
  /** Override engine.provider for this invocation (--engine). */
  engine?: string;
  /** Override engine.auth for this invocation (--auth). */
  auth?: string;
}

async function resolveSdk(
  provider: EngineProvider,
  authMode: EngineAuth,
  injected?: ResumeSdk
): Promise<ResumeSdk> {
  if (injected) return injected;
  if (provider === "claude-agent") {
    const { createClaudeAgentSdk } = await import("./engines/claudeAgentSdk.js");
    return createClaudeAgentSdk({ authMode }) as unknown as ResumeSdk;
  }
  const mod = await import("@cursor/sdk");
  return mod.Agent as unknown as ResumeSdk;
}

export async function cmdResume(
  sessionId: string,
  prompt: string,
  opts: ResumeOptions = {}
): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  const write = opts.write ?? ((s: string) => process.stdout.write(s));

  if (!sessionId || !sessionId.trim()) {
    console.error("resume: a session id is required (see `cursor-agent sessions`)");
    return EXIT.usage;
  }
  if (!prompt || !prompt.trim()) {
    console.error('resume: a prompt is required, e.g. cursor-agent resume <id> "continue"');
    return EXIT.usage;
  }
  let cfg: AgentConfig;
  try {
    cfg = loadConfig(dir);
    cfg = applyEngineOverride(cfg, opts.engine, opts.auth);
  } catch (e) {
    console.error("resume: " + (e instanceof ConfigError ? e.message : String(e)));
    return EXIT.config;
  }

  const provider = cfg.engine.provider;
  const authMode: EngineAuth = provider === "claude-agent" ? (cfg.engine.auth ?? "api-key") : "api-key";

  let apiKey = "";
  if (provider === "cursor") {
    apiKey = resolveApiKey(dir).key;
    if (!apiKey) {
      console.error(`resume: ${API_KEY_HELP}`);
      return EXIT.config;
    }
  } else if (authMode === "account") {
    apiKey = resolveClaudeOAuthToken(dir).key; // empty ok → `claude login` session
  } else {
    apiKey = resolveAnthropicKey(dir).key;
    if (!apiKey) {
      console.error(`resume: ${ANTHROPIC_API_KEY_HELP}`);
      return EXIT.config;
    }
  }

  const effectiveModel =
    provider === "claude-agent" ? (cfg.engine.model ?? DEFAULT_CLAUDE_AGENT_MODEL) : cfg.model;
  cfg = { ...cfg, model: effectiveModel };

  const store = createStore(dir, cfg.stateDir);
  try {
    const session = await store.getSession(sessionId);
    if (!session) {
      console.error(`resume: session '${sessionId}' not found (see \`cursor-agent sessions\`)`);
      return EXIT.usage;
    }
    const sessionEngine = (session.engine ?? "").trim() || "cursor";
    if (sessionEngine !== provider) {
      console.error(
        `resume: session '${sessionId}' was created with engine '${sessionEngine}', but the active engine is '${provider}'. Set engine.provider to '${sessionEngine}' or start a new session.`
      );
      return EXIT.usage;
    }

    let finalPrompt: string;
    let mcpServers: ReturnType<typeof resolveMcpServers>;
    try {
      const skillList = opts.skills?.length ? loadSkills(dir, cfg.skillsPath, opts.skills) : [];
      const { taskText, blocks: preTurnBlocks } = await buildPreTurnBlocks({
        dir,
        cfg,
        rawMessage: prompt,
        includeProfile: true,
      });
      const sessionMemoryBlocks = await sessionStartMemoryBlocks(dir, cfg);
      const autoRagBlocks = await autoRagMemoryBlocks(dir, taskText, cfg);
      mcpServers = resolveMcpServers(cfg, dir);
      finalPrompt = await composePrompt({
        userPrompt: taskText,
        cwd: cfg.cwd,
        dir,
        skills: skillList,
        sessionMemoryBlocks,
        preTurnBlocks,
        autoRagBlocks,
      });
    } catch (e) {
      if (e instanceof ContextRefError || e instanceof MemoryError || e instanceof SkillError) {
        console.error("resume: " + e.message);
        return EXIT.usage;
      }
      throw e;
    }

    // Gate composed prompt — @file/@memory content goes through the same denylist.
    const gate = await safetyGate({ prompt: finalPrompt, interactive: false, override: opts.yesIUnderstand });
    if (!gate.allowed) {
      console.error(`resume: blocked — ${gate.reason}`);
      return EXIT.noperm;
    }

    let sdk: ResumeSdk;
    try {
      sdk = await resolveSdk(provider, authMode, opts.sdk);
    } catch (e) {
      const pkg = provider === "claude-agent" ? "@anthropic-ai/claude-agent-sdk" : "@cursor/sdk";
      console.error(`resume: cannot load ${pkg}: ` + redact((e as Error).message));
      return EXIT.software;
    }

    const connected = await connectAgentForSession(sdk, store, session, cfg, apiKey, mcpServers);
    const { agent, mode, replayPrefix, liveResumeError } = connected;
    if (mode === "replayed") {
      console.error(
        `resume: live resume unavailable (${liveResumeError}); replaying transcript into a fresh agent`
      );
      finalPrompt = replayPrefix + "Continue. New request:\n\n" + finalPrompt;
    }

    const runId = newId("run");
    const startedAt = nowIso();
    try {
      const run: RunLike = await sendAgentTurn(agent, finalPrompt, cfg.model);
      let turnText = "";
      if (typeof run.stream === "function") {
        for await (const ev of run.stream()) {
          const t = eventText(ev);
          if (t) {
            turnText += t;
            write(t);
          }
        }
        write("\n");
      }
      const res = await run.wait();
      const status = String(res.status);
      const newAgentId = agent.agentId ?? session.sdk_agent_id;
      console.error(`[resume] session=${sessionId} mode=${mode} runId=${res.id ?? "-"} status=${status}`);
      await store.recordRun({
        id: runId,
        session_id: sessionId,
        sdk_agent_id: newAgentId,
        sdk_run_id: res.id ?? null,
        prompt_preview: preview(prompt),
        result_preview: resultPreview(turnText),
        status,
        error_kind: status === "error" ? "run_error" : null,
        error_detail:
          status === "error"
            ? formatErrorDetail([pickRunErrorDetail(res), `partialChars=${turnText.length}`])
            : null,
        started_at: startedAt,
        finished_at: nowIso(),
        cwd: session.cwd || cfg.cwd,
        runtime: session.runtime || cfg.runtime,
        model: cfg.model,
      });
      await store.upsertSession({
        id: sessionId,
        title: session.title,
        cwd: session.cwd || cfg.cwd,
        runtime: session.runtime || cfg.runtime,
        sdk_agent_id: newAgentId,
        last_status: status,
        channel: session.channel ?? "",
        engine: session.engine ?? "",
      });
      return status === "error" ? EXIT.software : EXIT.ok;
    } finally {
      await disposeAgent(agent);
    }
  } catch (e) {
    // Both live resume and replay failed to even start.
    console.error("resume: failed: " + redact(e instanceof StartupError ? e.message : (e as Error).message));
    return EXIT.software;
  } finally {
    await store.close();
  }
}
