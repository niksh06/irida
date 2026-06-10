/**
 * `cursor-agent run "<prompt>"` — one-shot local task via Cursor SDK (issue 008).
 * Non-interactive: destructive prompts are denied (safety, issue 006).
 * Persists run + session metadata to SQLite (issue 007). Maps to exit codes.
 */
import { loadConfig, ConfigError } from "./config.js";
import { runOneShot, StartupError, type SdkLike } from "./host.js";
import { createStore } from "./store.js";
import { SESSION_CHANNEL } from "./sessionChannel.js";
import { safetyGate } from "./safety.js";
import { loadSkills, SkillError } from "./skills.js";
import { resolveMcpServers } from "./mcpServers.js";
import { composePrompt, ContextRefError, MemoryError } from "./composePrompt.js";
import { sessionStartMemoryBlocks } from "./memory.js";
import { redact } from "./redact.js";
import { newId, preview, resultPreview, nowIso } from "./util.js";
import { EXIT, type ExitCode } from "./exit.js";
import { API_KEY_HELP, resolveApiKey } from "./credentials.js";
import { formatErrorDetail } from "./runErrorDetail.js";

export interface RunOptions {
  sdk?: SdkLike;
  dir?: string;
  /** Agent working directory (defaults to config cwd). */
  cwd?: string;
  skills?: string[];
  yesIUnderstand?: boolean;
}

export interface RunResult {
  exitCode: ExitCode;
  /** Assistant text on success; empty on early failure. */
  text: string;
}

async function resolveSdk(injected?: SdkLike): Promise<SdkLike> {
  if (injected) return injected;
  const mod = await import("@cursor/sdk");
  return mod.Agent as unknown as SdkLike;
}

export async function runPrompt(prompt: string, opts: RunOptions = {}): Promise<RunResult> {
  const dir = opts.dir ?? process.cwd();

  if (!prompt || !prompt.trim()) {
    console.error('run: a prompt is required, e.g. cursor-agent run "summarize this repo"');
    return { exitCode: EXIT.usage, text: "" };
  }
  const { key: apiKey } = resolveApiKey(dir);
  if (!apiKey) {
    console.error(`run: ${API_KEY_HELP}`);
    return { exitCode: EXIT.config, text: "" };
  }

  let cfg;
  try {
    cfg = loadConfig(dir);
  } catch (e) {
    console.error("run: " + (e instanceof ConfigError ? e.message : String(e)));
    return { exitCode: EXIT.config, text: "" };
  }
  const agentCwd = opts.cwd ?? cfg.cwd;
  if (cfg.runtime === "cloud" && !cfg.safety.allowCloud) {
    console.error("run: cloud runtime requires safety.allowCloud=true (MVP is local-first)");
    return { exitCode: EXIT.config, text: "" };
  }

  let finalPrompt: string;
  let mcpServers: ReturnType<typeof resolveMcpServers>;
  try {
    const skills = opts.skills?.length ? loadSkills(dir, cfg.skillsPath, opts.skills) : [];
    const sessionMemoryBlocks = await sessionStartMemoryBlocks(dir, cfg);
    mcpServers = resolveMcpServers(cfg, dir);
    finalPrompt = await composePrompt({
      userPrompt: prompt,
      cwd: agentCwd,
      dir,
      skills,
      sessionMemoryBlocks,
    });
  } catch (e) {
    if (e instanceof ContextRefError || e instanceof MemoryError || e instanceof SkillError) {
      console.error("run: " + e.message);
      return { exitCode: EXIT.usage, text: "" };
    }
    throw e;
  }

  // Gate the composed prompt: destructive content smuggled via @file/@memory
  // refs must hit the same denylist as the raw message.
  const gate = await safetyGate({ prompt: finalPrompt, interactive: false, override: opts.yesIUnderstand });
  if (!gate.allowed) {
    console.error(`run: blocked — ${gate.reason}. Use 'cursor-agent chat' or --yes-i-understand.`);
    return { exitCode: EXIT.noperm, text: "" };
  }

  const store = createStore(dir, cfg.stateDir);
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
      cwd: agentCwd,
      mcpServers,
    });
    console.error(`[run] agentId=${r.agentId ?? "-"} runId=${r.runId ?? "-"} status=${r.status}`);
    const failed = r.status === "error";
    await store.upsertSession({
      id: sessionId,
      title: preview(prompt, 60),
      cwd: agentCwd,
      runtime: cfg.runtime,
      sdk_agent_id: r.agentId,
      last_status: r.status,
      channel: SESSION_CHANNEL.run,
    });
    await store.recordRun({
      id: runId,
      session_id: sessionId,
      sdk_agent_id: r.agentId,
      sdk_run_id: r.runId,
      prompt_preview: preview(prompt),
      result_preview: resultPreview(r.text),
      status: r.status,
      error_kind: failed ? "run_error" : null,
      error_detail: failed ? formatErrorDetail([r.text]) : null,
      started_at: startedAt,
      finished_at: nowIso(),
      cwd: agentCwd,
      runtime: cfg.runtime,
      model: cfg.model,
    });
    if (failed) {
      console.error("run: executed run failed (status=error)");
      return { exitCode: EXIT.software, text: r.text ?? "" };
    }
    const text = redact(r.text);
    console.log(text);
    return { exitCode: EXIT.ok, text };
  } catch (e) {
    if (e instanceof StartupError) {
      console.error("run: startup failed: " + redact(e.message));
      await store.upsertSession({
        id: sessionId,
        title: preview(prompt, 60),
        cwd: agentCwd,
        runtime: cfg.runtime,
        sdk_agent_id: null,
        last_status: "startup_error",
        channel: SESSION_CHANNEL.run,
      });
      await store.recordRun({
        id: runId,
        session_id: sessionId,
        sdk_agent_id: null,
        sdk_run_id: null,
        prompt_preview: preview(prompt),
        result_preview: "",
        status: "startup_error",
        error_kind: "startup",
        error_detail: formatErrorDetail([e.message]),
        started_at: startedAt,
        finished_at: nowIso(),
        cwd: agentCwd,
        runtime: cfg.runtime,
        model: cfg.model,
      });
      return { exitCode: EXIT.software, text: "" };
    }
    throw e;
  } finally {
    await store.close();
  }
}

export async function cmdRun(prompt: string, opts: RunOptions = {}): Promise<ExitCode> {
  const { exitCode } = await runPrompt(prompt, opts);
  return exitCode;
}
