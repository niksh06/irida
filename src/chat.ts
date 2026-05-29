/**
 * `cursor-agent chat` — interactive local SDK session (issue 009).
 * Agent.create + agent.send per turn, streams assistant text, waits for
 * terminal status, persists runs, disposes the agent on exit.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig, ConfigError } from "./config.js";
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
import { buildPrompt } from "./promptBuilder.js";
import { redact } from "./redact.js";
import { newId, preview, nowIso } from "./util.js";
import { EXIT, type ExitCode } from "./exit.js";

export interface ChatOptions {
  sdk?: SdkCreateLike;
  dir?: string;
  skills?: string[];
  /** Test/non-interactive driver: fixed input lines (no readline). */
  lines?: string[];
  /** Override confirmation (tests). Default: interactive y/N. */
  confirm?: Confirmer;
  /** Force interactivity flag (default: derived from lines/TTY). */
  interactive?: boolean;
  /** Sink for assistant output (tests). Default: stdout.write. */
  write?: (s: string) => void;
}

async function resolveSdk(injected?: SdkCreateLike): Promise<SdkCreateLike> {
  if (injected) return injected;
  const mod = await import("@cursor/sdk");
  return mod.Agent as unknown as SdkCreateLike;
}

export async function cmdChat(opts: ChatOptions = {}): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  const write = opts.write ?? ((s: string) => stdout.write(s));
  const scripted = Array.isArray(opts.lines);
  const interactive = opts.interactive ?? (!scripted && stdin.isTTY === true);

  const apiKey = (process.env.CURSOR_API_KEY ?? "").trim();
  if (!apiKey) {
    console.error("chat: CURSOR_API_KEY is not set (export it in your environment)");
    return EXIT.startup;
  }

  let cfg;
  try {
    cfg = loadConfig(dir);
  } catch (e) {
    console.error("chat: " + (e instanceof ConfigError ? e.message : String(e)));
    return EXIT.startup;
  }
  if (cfg.runtime === "cloud" && !cfg.safety.allowCloud) {
    console.error("chat: cloud runtime requires safety.allowCloud=true (MVP is local-first)");
    return EXIT.startup;
  }

  let skills: Skill[] = [];
  if (opts.skills && opts.skills.length) {
    try {
      skills = loadSkills(dir, cfg.skillsPath, opts.skills);
    } catch (e) {
      console.error("chat: " + (e instanceof SkillError ? e.message : String(e)));
      return EXIT.startup;
    }
  }

  const store = new Store(dir, cfg.stateDir);
  const sessionId = newId("sess");

  let sdk: SdkCreateLike;
  try {
    sdk = await resolveSdk(opts.sdk);
  } catch (e) {
    console.error("chat: cannot load @cursor/sdk: " + redact((e as Error).message));
    store.close();
    return EXIT.startup;
  }

  // Input source: scripted lines (tests) or readline.
  const rl = scripted ? null : createInterface({ input: stdin, output: stdout });
  const queued = [...(opts.lines ?? [])];
  const ask = async (): Promise<string | null> => {
    if (scripted) return queued.length ? (queued.shift() as string) : null;
    try {
      return await rl!.question("you> ");
    } catch {
      return null; // EOF / Ctrl-D
    }
  };

  const confirm: Confirmer =
    opts.confirm ??
    (async (reason) => {
      if (!rl) return false;
      const a = (await rl.question(`⚠ ${reason}. Proceed? [y/N] `)).trim().toLowerCase();
      return a === "y" || a === "yes";
    });

  let agent: AgentLike | null = null;
  let exitCode: ExitCode = EXIT.ok;
  let lastStatus = "created";
  try {
    agent = await createSession(sdk, {
      apiKey,
      model: cfg.model,
      cwd: cfg.cwd,
      mcpServers: cfg.mcpServers,
    });
    let firstTurn = true;
    console.error(`[chat] agentId=${agent.agentId ?? "-"} session=${sessionId} cwd=${cfg.cwd}`);
    store.upsertSession({
      id: sessionId,
      title: "chat session",
      cwd: cfg.cwd,
      runtime: cfg.runtime,
      sdk_agent_id: agent.agentId ?? null,
      last_status: lastStatus,
    });

    for (;;) {
      const line = await ask();
      if (line === null) break;
      const msg = line.trim();
      if (!msg) continue;
      if (msg === "exit" || msg === "quit" || msg === ":q") break;

      const gate = await safetyGate({ prompt: msg, interactive, confirm });
      if (!gate.allowed) {
        console.error(`chat: blocked — ${gate.reason}`);
        if (!interactive) {
          exitCode = EXIT.unsafe;
          break;
        }
        continue;
      }

      const runId = newId("run");
      const startedAt = nowIso();
      // Inject selected skills as context on the first turn only.
      const sendMsg = firstTurn && skills.length ? buildPrompt(msg, skills) : msg;
      firstTurn = false;
      const run: RunLike = await agent.send(sendMsg);
      if (typeof run.stream === "function") {
        for await (const ev of run.stream()) {
          const t = eventText(ev);
          if (t) write(t);
        }
        write("\n");
      }
      const res = await run.wait();
      lastStatus = String(res.status);
      console.error(`[chat] runId=${res.id ?? "-"} status=${lastStatus}`);
      store.recordRun({
        id: runId,
        session_id: sessionId,
        sdk_agent_id: agent.agentId ?? null,
        sdk_run_id: res.id ?? null,
        prompt_preview: preview(msg),
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
      if (lastStatus === "error") exitCode = EXIT.runError;
    }
  } catch (e) {
    if (e instanceof StartupError) {
      console.error("chat: startup failed: " + redact(e.message));
      exitCode = EXIT.startup;
    } else {
      console.error("chat: " + redact((e as Error).message));
      exitCode = EXIT.startup;
    }
  } finally {
    if (agent) await disposeAgent(agent);
    rl?.close();
    store.close();
  }
  return exitCode;
}
