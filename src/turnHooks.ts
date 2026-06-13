/**
 * Config-driven pre/post turn hook scripts (I-47).
 */
import { spawnSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import type { HookScriptConfig } from "./config.js";

export const HOOK_STDOUT_MAX_CHARS = 4096;

export interface TurnHookEnv {
  prompt: string;
  sessionId: string;
  channel: string;
  cwd: string;
}

export interface PreTurnHookResult {
  allowed: boolean;
  reason?: string;
  appendStdout?: string;
}

function resolveHookCommand(cwd: string, command: string): string {
  if (isAbsolute(command)) return command;
  return resolve(cwd, command);
}

function runHookScript(
  hook: HookScriptConfig,
  env: TurnHookEnv
): { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean } {
  const timeoutMs = hook.timeoutMs ?? 5000;
  const cmd = resolveHookCommand(env.cwd, hook.command);
  const child = spawnSync(cmd, {
    shell: true,
    cwd: env.cwd,
    env: {
      ...process.env,
      CSAGENT_PROMPT: env.prompt,
      CSAGENT_SESSION_ID: env.sessionId,
      CSAGENT_CHANNEL: env.channel,
    },
    encoding: "utf8",
    timeout: timeoutMs,
  });
  return {
    exitCode: child.status,
    stdout: (child.stdout ?? "").trim(),
    stderr: (child.stderr ?? "").trim(),
    timedOut: child.error?.message.includes("ETIMEDOUT") ?? false,
  };
}

export function runPreTurnHook(hook: HookScriptConfig, env: TurnHookEnv): PreTurnHookResult {
  const run = runHookScript(hook, env);
  if (run.timedOut) {
    return { allowed: false, reason: "preTurn hook timed out" };
  }
  if (run.exitCode === 2) {
    return { allowed: false, reason: run.stderr || run.stdout || "preTurn hook denied turn" };
  }
  if (run.exitCode !== 0 && run.exitCode !== null) {
    return { allowed: false, reason: run.stderr || `preTurn hook exit ${run.exitCode}` };
  }
  let appendStdout: string | undefined;
  if (run.stdout) {
    appendStdout =
      run.stdout.length > HOOK_STDOUT_MAX_CHARS
        ? `${run.stdout.slice(0, HOOK_STDOUT_MAX_CHARS)}…`
        : run.stdout;
  }
  return { allowed: true, appendStdout };
}

/** Best-effort; failures are logged only. */
export function runPostTurnHook(
  hook: HookScriptConfig,
  env: TurnHookEnv,
  onLog?: (line: string) => void
): void {
  const log = onLog ?? ((line: string) => console.error(line));
  const run = runHookScript(hook, env);
  if (run.timedOut) log("[hooks] postTurn timed out");
  else if (run.exitCode !== 0) {
    log(`[hooks] postTurn exit ${run.exitCode}: ${run.stderr || run.stdout || "(no output)"}`);
  }
}
