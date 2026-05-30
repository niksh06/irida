/**
 * `cursor-agent run "<prompt>"` — one-shot local task via Cursor SDK (issue 008).
 * Non-interactive: destructive prompts are denied (safety, issue 006).
 * Persists run + session metadata to SQLite (issue 007). Maps to exit codes.
 */
import { loadConfig, ConfigError } from "./config.js";
import { runOneShot, StartupError, type SdkLike } from "./host.js";
import { Store } from "./store.js";
import { safetyGate } from "./safety.js";
import { loadSkills, SkillError } from "./skills.js";
import { composePrompt, ContextRefError } from "./composePrompt.js";
import { redact } from "./redact.js";
import { newId, preview, resultPreview, nowIso } from "./util.js";
import { EXIT, type ExitCode } from "./exit.js";
import { API_KEY_HELP, resolveApiKey } from "./credentials.js";

export interface RunOptions {
  sdk?: SdkLike;
  dir?: string;
  skills?: string[];
  yesIUnderstand?: boolean;
}

async function resolveSdk(injected?: SdkLike): Promise<SdkLike> {
  if (injected) return injected;
  const mod = await import("@cursor/sdk");
  return mod.Agent as unknown as SdkLike;
}

export async function cmdRun(prompt: string, opts: RunOptions = {}): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();

  if (!prompt || !prompt.trim()) {
    console.error('run: a prompt is required, e.g. cursor-agent run "summarize this repo"');
    return EXIT.usage;
  }
  const { key: apiKey } = resolveApiKey(dir);
  if (!apiKey) {
    console.error(`run: ${API_KEY_HELP}`);
    return EXIT.config;
  }

  let cfg;
  try {
    cfg = loadConfig(dir);
  } catch (e) {
    console.error("run: " + (e instanceof ConfigError ? e.message : String(e)));
    return EXIT.config;
  }
  if (cfg.runtime === "cloud" && !cfg.safety.allowCloud) {
    console.error("run: cloud runtime requires safety.allowCloud=true (MVP is local-first)");
    return EXIT.config;
  }

  // One-shot is non-interactive: destructive prompts are denied unless the
  // caller explicitly acknowledges with --yes-i-understand.
  const gate = await safetyGate({ prompt, interactive: false, override: opts.yesIUnderstand });
  if (!gate.allowed) {
    console.error(`run: blocked — ${gate.reason}. Use 'cursor-agent chat' or --yes-i-understand.`);
    return EXIT.noperm;
  }

  let finalPrompt: string;
  try {
    const skills = opts.skills?.length ? loadSkills(dir, cfg.skillsPath, opts.skills) : [];
    finalPrompt = composePrompt({ userPrompt: prompt, cwd: cfg.cwd, skills });
  } catch (e) {
    if (e instanceof ContextRefError || e instanceof SkillError) {
      console.error("run: " + e.message);
      return EXIT.usage;
    }
    throw e;
  }

  const store = new Store(dir, cfg.stateDir);
  const sessionId = newId("sess");
  const runId = newId("run");
  const startedAt = nowIso();

  try {
    const sdk = await resolveSdk(opts.sdk).catch((e) => {
      throw new StartupError("cannot load @cursor/sdk: " + (e as Error).message);
    });
    const r = await runOneShot(sdk, {
      prompt: finalPrompt,
      apiKey,
      model: cfg.model,
      cwd: cfg.cwd,
      mcpServers: cfg.mcpServers,
    });
    console.error(`[run] agentId=${r.agentId ?? "-"} runId=${r.runId ?? "-"} status=${r.status}`);
    const failed = r.status === "error";
    store.upsertSession({
      id: sessionId,
      title: preview(prompt, 60),
      cwd: cfg.cwd,
      runtime: cfg.runtime,
      sdk_agent_id: r.agentId,
      last_status: r.status,
    });
    store.recordRun({
      id: runId,
      session_id: sessionId,
      sdk_agent_id: r.agentId,
      sdk_run_id: r.runId,
      prompt_preview: preview(prompt),
      result_preview: resultPreview(r.text),
      status: r.status,
      error_kind: failed ? "run_error" : null,
      started_at: startedAt,
      finished_at: nowIso(),
      cwd: cfg.cwd,
      runtime: cfg.runtime,
      model: cfg.model,
    });
    if (failed) {
      console.error("run: executed run failed (status=error)");
      return EXIT.software;
    }
    console.log(redact(r.text));
    return EXIT.ok;
  } catch (e) {
    if (e instanceof StartupError) {
      console.error("run: startup failed: " + redact(e.message));
      store.upsertSession({
        id: sessionId,
        title: preview(prompt, 60),
        cwd: cfg.cwd,
        runtime: cfg.runtime,
        sdk_agent_id: null,
        last_status: "startup_error",
      });
      store.recordRun({
        id: runId,
        session_id: sessionId,
        sdk_agent_id: null,
        sdk_run_id: null,
        prompt_preview: preview(prompt),
        result_preview: "",
        status: "startup_error",
        error_kind: "startup",
        started_at: startedAt,
        finished_at: nowIso(),
        cwd: cfg.cwd,
        runtime: cfg.runtime,
        model: cfg.model,
      });
      return EXIT.software;
    }
    throw e;
  } finally {
    store.close();
  }
}
