/**
 * Built-in turn context: mode prefix (ADVICE/DO/…) + optional profile excerpt (I-52).
 */
import { readMemory } from "./memory.js";
import { createMemoryStore } from "./memoryStore.js";
import type { AgentConfig } from "./config.js";

export type TurnMode = "advice" | "do" | "debug" | "sync";

/** All turn modes (I-91 — /mode slash + per-chat persistence). */
export const TURN_MODES: readonly TurnMode[] = ["advice", "do", "debug", "sync"];

const MODE_PREFIX_RE = /^(ADVICE|DO|DEBUG|SYNC):\s*/i;

/** True if the message already carries an explicit mode prefix (ADVICE:/DO:/…). */
export function hasModePrefix(text: string): boolean {
  return MODE_PREFIX_RE.test(text.trim());
}

/** Parse a /mode argument into a TurnMode, or undefined if not a valid mode. */
export function parseModeArg(raw: string): TurnMode | undefined {
  const v = raw.trim().toLowerCase();
  return (TURN_MODES as readonly string[]).includes(v) ? (v as TurnMode) : undefined;
}

const MODE_LINES: Record<TurnMode, string> = {
  advice: "Mode: ADVICE — discuss options and trade-offs; do not implement unless asked.",
  do: "Mode: DO — implement or execute; minimal preamble.",
  debug: "Mode: DEBUG — investigate root cause; reproduce before fixing.",
  sync: "Mode: SYNC — status update only; no new work.",
};

const DEFAULT_PROFILE_MAX_CHARS = 1500;
const DEFAULT_MODE_ENV = "CSAGENT_MODE";

function isTurnMode(raw: string): raw is TurnMode {
  return raw === "ADVICE" || raw === "DO" || raw === "DEBUG" || raw === "SYNC";
}

function normalizeEnvMode(raw: string | undefined): TurnMode | undefined {
  if (!raw?.trim()) return undefined;
  const upper = raw.trim().toUpperCase();
  if (!isTurnMode(upper)) return undefined;
  return upper.toLowerCase() as TurnMode;
}

/** Strip leading mode prefix; env fallback when preTurn config is present. */
export function parseTurnMode(
  raw: string,
  opts?: { modeEnv?: string; envFallback?: boolean }
): { taskText: string; mode: TurnMode | undefined } {
  const trimmed = raw.trim();
  const m = trimmed.match(MODE_PREFIX_RE);
  if (m) {
    const mode = m[1]!.toLowerCase() as TurnMode;
    return { taskText: trimmed.slice(m[0].length).trim(), mode };
  }
  if (opts?.envFallback) {
    const envVar = opts.modeEnv?.trim() || DEFAULT_MODE_ENV;
    const mode = normalizeEnvMode(process.env[envVar]);
    return { taskText: trimmed, mode };
  }
  return { taskText: trimmed, mode: undefined };
}

export function formatModeBlock(mode: TurnMode): string {
  return MODE_LINES[mode];
}

function formatProfileBlock(name: string, body: string): string {
  return `### User profile excerpt (${name})\n\n${body.trim()}`;
}

/** Profile note excerpt for preTurn (fail-soft when missing). */
export async function preTurnProfileBlock(dir: string, cfg: AgentConfig): Promise<string | undefined> {
  const noteName = cfg.memory?.preTurn?.profileNote?.trim();
  if (!noteName) return undefined;

  const maxChars =
    typeof cfg.memory.preTurn?.profileMaxChars === "number" &&
    cfg.memory.preTurn.profileMaxChars >= 256
      ? Math.min(cfg.memory.preTurn.profileMaxChars, 8000)
      : DEFAULT_PROFILE_MAX_CHARS;

  const store = createMemoryStore(dir, cfg.stateDir);
  try {
    const note = await store.getNote(noteName);
    if (note) {
      if (note.body === "(encrypted — use memory show)") return undefined;
      return formatProfileBlock(noteName, note.body.slice(0, maxChars));
    }
    try {
      const body = readMemory(dir, noteName);
      return formatProfileBlock(noteName, body.slice(0, maxChars));
    } catch {
      return undefined;
    }
  } finally {
    await store.close();
  }
}

export async function buildPreTurnBlocks(args: {
  dir: string;
  cfg: AgentConfig;
  rawMessage: string;
  includeProfile: boolean;
}): Promise<{ taskText: string; blocks: string[] }> {
  const preTurnCfg = args.cfg.memory?.preTurn;
  const { taskText, mode } = parseTurnMode(args.rawMessage, {
    modeEnv: preTurnCfg?.modeEnv,
    envFallback: preTurnCfg !== undefined,
  });

  const blocks: string[] = [];
  if (mode) blocks.push(formatModeBlock(mode));
  if (args.includeProfile && preTurnCfg?.profileNote?.trim()) {
    const profile = await preTurnProfileBlock(args.dir, args.cfg);
    if (profile) blocks.push(profile);
  }
  return { taskText, blocks };
}
