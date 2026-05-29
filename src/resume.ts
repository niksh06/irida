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
import {
  resumeSession,
  createSession,
  disposeAgent,
  eventText,
  StartupError,
  type AgentLike,
  type RunLike,
  type SdkResumeLike,
  type SdkCreateLike,
} from "./host.js";
import { Store } from "./store.js";
import { safetyGate } from "./safety.js";
import { loadSkills, SkillError } from "./skills.js";
import { buildPrompt } from "./promptBuilder.js";
import { redact } from "./redact.js";
import { newId, preview, resultPreview, nowIso } from "./util.js";
import { EXIT, type ExitCode } from "./exit.js";

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

function replayPreamble(store: Store, sessionId: string, max = 10): string {
  const runs = store.listRuns(sessionId).slice(-max);
  if (runs.length === 0) return "";
  const turns = runs
    .map((r) => `User: ${r.prompt_preview}\nAssistant: ${r.result_preview || "(no stored output)"}`)
    .join("\n\n");
  return `Earlier in this session (transcript, may be truncated):\n\n${turns}\n\n`;
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
  const apiKey = (process.env.CURSOR_API_KEY ?? "").trim();
  if (!apiKey) {
    console.error("resume: CURSOR_API_KEY is not set (export it in your environment)");
    return EXIT.config;
  }

  let cfg: AgentConfig;
  try {
    cfg = loadConfig(dir);
  } catch (e) {
    console.error("resume: " + (e instanceof ConfigError ? e.message : String(e)));
    return EXIT.config;
  }

  const store = new Store(dir, cfg.stateDir);
  try {
    const session = store.getSession(sessionId);
    if (!session) {
      console.error(`resume: session '${sessionId}' not found (see \`cursor-agent sessions\`)`);
      return EXIT.usage;
    }

    const gate = await safetyGate({ prompt, interactive: false, override: opts.yesIUnderstand });
    if (!gate.allowed) {
      console.error(`resume: blocked — ${gate.reason}`);
      return EXIT.noperm;
    }

    let finalPrompt = prompt;
    if (opts.skills && opts.skills.length) {
      try {
        finalPrompt = buildPrompt(prompt, loadSkills(dir, cfg.skillsPath, opts.skills));
      } catch (e) {
        console.error("resume: " + (e instanceof SkillError ? e.message : String(e)));
        return EXIT.usage;
      }
    }

    let sdk: ResumeSdk;
    try {
      sdk = await resolveSdk(opts.sdk);
    } catch (e) {
      console.error("resume: cannot load @cursor/sdk: " + redact((e as Error).message));
      return EXIT.software;
    }

    // Path 1: live resume. Path 2: transcript replay into a fresh agent.
    let agent: AgentLike;
    let mode: "resumed" | "replayed";
    let liveErr = "";
    if (session.sdk_agent_id) {
      try {
        agent = await resumeSession(sdk, session.sdk_agent_id, apiKey, cfg.mcpServers);
        mode = "resumed";
      } catch (e) {
        liveErr = e instanceof StartupError ? e.message : String(e);
        agent = await tryReplay();
        mode = "replayed";
      }
    } else {
      liveErr = "no stored SDK agent id";
      agent = await tryReplay();
      mode = "replayed";
    }

    async function tryReplay(): Promise<AgentLike> {
      console.error(`resume: live resume unavailable (${redact(liveErr)}); replaying transcript into a fresh agent`);
      finalPrompt = replayPreamble(store, sessionId) + "Continue. New request:\n\n" + finalPrompt;
      return createSession(sdk, { apiKey, model: cfg.model, cwd: session!.cwd || cfg.cwd, mcpServers: cfg.mcpServers });
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
      store.recordRun({
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
      store.upsertSession({
        id: sessionId,
        title: session.title,
        cwd: session.cwd || cfg.cwd,
        runtime: session.runtime || cfg.runtime,
        sdk_agent_id: newAgentId,
        last_status: status,
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
    store.close();
  }
}
