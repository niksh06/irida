/**
 * `cursor-agent run "<prompt>"` — one-shot local task via Cursor SDK (issue 008).
 * Non-interactive: destructive prompts are denied (safety, issue 006).
 * Persists run + session metadata to SQLite (issue 007). Maps to exit codes.
 */
import { loadConfig, ConfigError } from "./config.js";
import { runOneShot, StartupError, type SdkLike } from "./host.js";
import { Store } from "./store.js";
import { safetyGate } from "./safety.js";
import { redact } from "./redact.js";
import { newId, preview, nowIso } from "./util.js";
import { EXIT, type ExitCode } from "./exit.js";

export interface RunOptions {
  sdk?: SdkLike;
  dir?: string;
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
    return EXIT.startup;
  }
  const apiKey = (process.env.CURSOR_API_KEY ?? "").trim();
  if (!apiKey) {
    console.error("run: CURSOR_API_KEY is not set (export it in your environment)");
    return EXIT.startup;
  }

  let cfg;
  try {
    cfg = loadConfig(dir);
  } catch (e) {
    console.error("run: " + (e instanceof ConfigError ? e.message : String(e)));
    return EXIT.startup;
  }
  if (cfg.runtime === "cloud" && !cfg.safety.allowCloud) {
    console.error("run: cloud runtime requires safety.allowCloud=true (MVP is local-first)");
    return EXIT.startup;
  }

  // One-shot is non-interactive: destructive prompts are denied.
  const gate = await safetyGate({ prompt, interactive: false });
  if (!gate.allowed) {
    console.error(`run: blocked — ${gate.reason}. Use 'cursor-agent chat' to confirm interactively.`);
    return EXIT.unsafe;
  }

  const store = new Store(dir, cfg.stateDir);
  const sessionId = newId("sess");
  const runId = newId("run");
  const startedAt = nowIso();

  try {
    const sdk = await resolveSdk(opts.sdk).catch((e) => {
      throw new StartupError("cannot load @cursor/sdk: " + (e as Error).message);
    });
    const r = await runOneShot(sdk, { prompt, apiKey, model: cfg.model, cwd: cfg.cwd });
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
      return EXIT.runError;
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
        status: "startup_error",
        error_kind: "startup",
        started_at: startedAt,
        finished_at: nowIso(),
        cwd: cfg.cwd,
        runtime: cfg.runtime,
        model: cfg.model,
      });
      return EXIT.startup;
    }
    throw e;
  } finally {
    store.close();
  }
}
