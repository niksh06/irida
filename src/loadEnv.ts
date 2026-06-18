/**
 * Load csagent env files before CLI/MCP startup (no dotenv dependency).
 * Does not override variables already set in the process environment.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

/** Warn when a secret-bearing env file is group/other-readable (POSIX only). */
function warnIfWorldReadable(path: string): void {
  try {
    const fullMode = statSync(path).mode & 0o777;
    if ((fullMode & 0o077) !== 0) {
      console.error(`[env] ${path} is group/other-readable (mode ${fullMode.toString(8)}) — it holds secrets; run: chmod 600 ${path}`);
    }
  } catch {
    /* non-POSIX / stat failure — best effort */
  }
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Parse bash-style `export KEY=val` lines; skip comments and blanks. */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    out[m[1]!] = stripQuotes(m[2]!.trim());
  }
  return out;
}

function applyEnvFile(path: string): void {
  if (!existsSync(path)) return;
  warnIfWorldReadable(path);
  let parsed: Record<string, string>;
  try {
    parsed = parseEnvFile(readFileSync(path, "utf8"));
  } catch {
    return;
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Load env in precedence order (first wins; never overrides existing env). */
export function loadCsagentEnv(cwd: string = process.cwd()): string[] {
  const loaded: string[] = [];
  const candidates: string[] = [];
  const explicit = process.env.CSAGENT_ENV?.trim();
  if (explicit) candidates.push(explicit);
  candidates.push(resolve(homedir(), ".csagent/csagent.env"));
  candidates.push(resolve(cwd, ".env"));

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    applyEnvFile(path);
    loaded.push(path);
  }
  return loaded;
}
