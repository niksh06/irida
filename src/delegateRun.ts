/**
 * Subagent delegate (issue 040) — isolated one-shot SDK run, summary only.
 */
import { loadConfig } from "./config.js";
import { resolveApiKey } from "./credentials.js";
import { runPrompt } from "./run.js";
import type { SdkLike } from "./host.js";

export interface DelegateOptions {
  dir?: string;
  prompt: string;
  cwd?: string;
  skills?: string[];
  sdk?: SdkLike;
  yesIUnderstand?: boolean;
}

export interface DelegateResult {
  ok: boolean;
  summary: string;
  runId: string | null;
}

export async function runDelegate(opts: DelegateOptions): Promise<DelegateResult> {
  const dir = opts.dir ?? process.cwd();
  const cfg = loadConfig(dir);
  const workDir = opts.cwd?.trim() || cfg.cwd || dir;
  const wrapped = `[delegate] ${opts.prompt.trim()}\n\nReply with a concise summary for the parent agent (bullet points, max 400 words).`;
  const { key } = resolveApiKey(dir);
  if (!key) {
    return { ok: false, summary: "CURSOR_API_KEY not set", runId: null };
  }
  const out = await runPrompt(wrapped, {
    dir: workDir,
    sdk: opts.sdk,
    skills: opts.skills,
    yesIUnderstand: opts.yesIUnderstand,
  });
  return {
    ok: out.exitCode === 0,
    summary: out.text?.trim() || "(empty)",
    runId: null,
  };
}
