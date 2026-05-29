/**
 * `cursor-agent resume <session-id> "<prompt>"` — continue a stored session
 * via Cursor SDK Agent.resume using the persisted SDK agent id (issue 011).
 * One-shot follow-up for MVP; interactive resume is post-MVP.
 *
 * Distinct failures: missing session / missing SDK agent id / SDK resume
 * failure — none corrupt stored state.
 */
import { loadConfig, ConfigError } from "./config.js";
import {
  resumeSession,
  disposeAgent,
  eventText,
  StartupError,
  type AgentLike,
  type RunLike,
  type SdkResumeLike,
} from "./host.js";
import { Store } from "./store.js";
import { safetyGate } from "./safety.js";
import { redact } from "./redact.js";
import { newId, preview, nowIso } from "./util.js";
import { EXIT, type ExitCode } from "./exit.js";

export interface ResumeOptions {
  sdk?: SdkResumeLike;
  dir?: string;
  write?: (s: string) => void;
}

async function resolveSdk(injected?: SdkResumeLike): Promise<SdkResumeLike> {
  if (injected) return injected;
  const mod = await import("@cursor/sdk");
  return mod.Agent as unknown as SdkResumeLike;
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
    return EXIT.startup;
  }
  if (!prompt || !prompt.trim()) {
    console.error('resume: a prompt is required, e.g. cursor-agent resume <id> "continue"');
    return EXIT.startup;
  }
  const apiKey = (process.env.CURSOR_API_KEY ?? "").trim();
  if (!apiKey) {
    console.error("resume: CURSOR_API_KEY is not set (export it in your environment)");
    return EXIT.startup;
  }

  let cfg;
  try {
    cfg = loadConfig(dir);
  } catch (e) {
    console.error("resume: " + (e instanceof ConfigError ? e.message : String(e)));
    return EXIT.startup;
  }

  const store = new Store(dir, cfg.stateDir);
  try {
    const session = store.getSession(sessionId);
    if (!session) {
      console.error(`resume: session '${sessionId}' not found (see \`cursor-agent sessions\`)`);
      return EXIT.startup;
    }
    if (!session.sdk_agent_id) {
      console.error(`resume: session '${sessionId}' has no SDK agent id — cannot resume`);
      return EXIT.startup;
    }

    // One-shot resume is non-interactive: destructive prompts are denied.
    const gate = await safetyGate({ prompt, interactive: false });
    if (!gate.allowed) {
      console.error(`resume: blocked — ${gate.reason}`);
      return EXIT.unsafe;
    }

    let sdk: SdkResumeLike;
    try {
      sdk = await resolveSdk(opts.sdk);
    } catch (e) {
      console.error("resume: cannot load @cursor/sdk: " + redact((e as Error).message));
      return EXIT.startup;
    }

    let agent: AgentLike;
    try {
      agent = await resumeSession(sdk, session.sdk_agent_id, apiKey);
    } catch (e) {
      const msg = e instanceof StartupError ? e.message : String(e);
      console.error("resume: SDK resume failed: " + redact(msg));
      return EXIT.startup;
    }

    const runId = newId("run");
    const startedAt = nowIso();
    try {
      const run: RunLike = await agent.send(prompt);
      if (typeof run.stream === "function") {
        for await (const ev of run.stream()) {
          const t = eventText(ev);
          if (t) write(t);
        }
        write("\n");
      }
      const res = await run.wait();
      const status = String(res.status);
      console.error(`[resume] session=${sessionId} runId=${res.id ?? "-"} status=${status}`);
      store.recordRun({
        id: runId,
        session_id: sessionId,
        sdk_agent_id: session.sdk_agent_id,
        sdk_run_id: res.id ?? null,
        prompt_preview: preview(prompt),
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
        sdk_agent_id: session.sdk_agent_id,
        last_status: status,
      });
      return status === "error" ? EXIT.runError : EXIT.ok;
    } finally {
      await disposeAgent(agent);
    }
  } finally {
    store.close();
  }
}
