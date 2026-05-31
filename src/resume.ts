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
import { loadConfig, ConfigError, type AgentConfig } from "./config.js";
import { disposeAgent, eventText, StartupError, type RunLike, type SdkResumeLike, type SdkCreateLike } from "./host.js";
import { createStore } from "./store.js";
import { safetyGate } from "./safety.js";
import { loadSkills, SkillError } from "./skills.js";
import { resolveMcpServers } from "./mcpServers.js";
import { composePrompt, ContextRefError, MemoryError } from "./composePrompt.js";
import { sessionStartMemoryBlocks } from "./memory.js";
import { redact } from "./redact.js";
import { newId, preview, resultPreview, nowIso } from "./util.js";
import { EXIT, type ExitCode } from "./exit.js";
import { connectAgentForSession } from "./sessionConnect.js";
import { API_KEY_HELP, resolveApiKey } from "./credentials.js";

type ResumeSdk = SdkResumeLike & SdkCreateLike;

export interface ResumeOptions {
  sdk?: ResumeSdk;
  dir?: string;
  write?: (s: string) => void;
  yesIUnderstand?: boolean;
  skills?: string[];
}

async function resolveSdk(injected?: ResumeSdk): Promise<ResumeSdk> {
  if (injected) return injected;
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
  const { key: apiKey } = resolveApiKey(dir);
  if (!apiKey) {
    console.error(`resume: ${API_KEY_HELP}`);
    return EXIT.config;
  }

  let cfg: AgentConfig;
  try {
    cfg = loadConfig(dir);
  } catch (e) {
    console.error("resume: " + (e instanceof ConfigError ? e.message : String(e)));
    return EXIT.config;
  }

  const store = createStore(dir, cfg.stateDir);
  try {
    const session = await store.getSession(sessionId);
    if (!session) {
      console.error(`resume: session '${sessionId}' not found (see \`cursor-agent sessions\`)`);
      return EXIT.usage;
    }

    const gate = await safetyGate({ prompt, interactive: false, override: opts.yesIUnderstand });
    if (!gate.allowed) {
      console.error(`resume: blocked — ${gate.reason}`);
      return EXIT.noperm;
    }

  let finalPrompt: string;
  let mcpServers: ReturnType<typeof resolveMcpServers>;
  try {
    const skillList = opts.skills?.length ? loadSkills(dir, cfg.skillsPath, opts.skills) : [];
    const sessionMemoryBlocks = await sessionStartMemoryBlocks(dir, cfg);
    mcpServers = resolveMcpServers(cfg, dir);
    finalPrompt = composePrompt({
        userPrompt: prompt,
        cwd: cfg.cwd,
        dir,
        skills: skillList,
        sessionMemoryBlocks,
      });
    } catch (e) {
      if (e instanceof ContextRefError || e instanceof MemoryError || e instanceof SkillError) {
        console.error("resume: " + e.message);
        return EXIT.usage;
      }
      throw e;
    }

    let sdk: ResumeSdk;
    try {
      sdk = await resolveSdk(opts.sdk);
    } catch (e) {
      console.error("resume: cannot load @cursor/sdk: " + redact((e as Error).message));
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
      const run: RunLike = await agent.send(finalPrompt);
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
