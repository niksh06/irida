/**
 * Project-local config (issue 003/004): ./agent.config.json + defaults.
 * Secrets NEVER live here — CURSOR_API_KEY comes from the environment.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const CONFIG_FILE = "agent.config.json";

export interface SafetyConfig {
  allowCloud: boolean;
  allowAutoPr: boolean;
}

export interface AgentConfig {
  model: string;
  runtime: "local" | "cloud";
  cwd: string;
  skillsPath: string;
  stateDir: string;
  mcpServers: Record<string, unknown>;
  safety: SafetyConfig;
}

export class ConfigError extends Error {}

/** Validate MCP server entries (stdio: command, http: url). Returns error strings. */
export function validateMcpServers(mcp: Record<string, unknown>): string[] {
  const errs: string[] = [];
  for (const [name, v] of Object.entries(mcp)) {
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      errs.push(`mcp '${name}': must be an object`);
      continue;
    }
    const o = v as Record<string, unknown>;
    const hasCmd = typeof o.command === "string" && o.command.trim().length > 0;
    const hasUrl = typeof o.url === "string" && o.url.trim().length > 0;
    if (!hasCmd && !hasUrl) {
      errs.push(`mcp '${name}': needs 'command' (stdio) or 'url' (http)`);
    }
  }
  return errs;
}

const SECRET_KEYS = ["CURSOR_API_KEY", "cursorApiKey", "apiKey", "api_key"];

/** Runtime home (~/.csagent): credentials, gateway, sqlite, memory. */
export function csagentHome(): string | undefined {
  const home = process.env.CSAGENT_HOME?.trim();
  return home || undefined;
}

export function defaultStateDir(_dir: string): string {
  const home = csagentHome();
  if (home) return resolve(home, ".agent");
  return ".agent";
}

export function defaults(dir: string): AgentConfig {
  return {
    model: "composer-2.5",
    runtime: "local",
    cwd: dir,
    skillsPath: "skills",
    stateDir: defaultStateDir(dir),
    mcpServers: {},
    safety: { allowCloud: false, allowAutoPr: false },
  };
}

export function loadConfig(dir: string = process.cwd()): AgentConfig {
  const path = resolve(dir, CONFIG_FILE);
  if (!existsSync(path)) return defaults(dir);

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    throw new ConfigError(`cannot read ${CONFIG_FILE}: ${(e as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ConfigError(`invalid JSON in ${CONFIG_FILE}: ${(e as Error).message}`);
  }
  return validate(parsed, dir);
}

function validate(obj: unknown, dir: string): AgentConfig {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new ConfigError(`${CONFIG_FILE} must be a JSON object`);
  }
  const o = obj as Record<string, unknown>;

  for (const k of SECRET_KEYS) {
    if (k in o) {
      throw new ConfigError(
        `secrets must not live in ${CONFIG_FILE}; set CURSOR_API_KEY in the environment`
      );
    }
  }

  const cfg = defaults(dir);

  if (o.model !== undefined) {
    if (typeof o.model !== "string" || !o.model.trim()) throw new ConfigError("model must be a non-empty string");
    cfg.model = o.model;
  }
  if (o.runtime !== undefined) {
    if (o.runtime !== "local" && o.runtime !== "cloud") throw new ConfigError("runtime must be 'local' or 'cloud'");
    cfg.runtime = o.runtime;
  }
  if (o.skillsPath !== undefined) {
    if (typeof o.skillsPath !== "string") throw new ConfigError("skillsPath must be a string");
    cfg.skillsPath = o.skillsPath;
  }
  if (o.stateDir !== undefined) {
    if (typeof o.stateDir !== "string") throw new ConfigError("stateDir must be a string");
    cfg.stateDir = o.stateDir;
  }
  if (o.mcpServers !== undefined) {
    if (typeof o.mcpServers !== "object" || o.mcpServers === null || Array.isArray(o.mcpServers)) {
      throw new ConfigError("mcpServers must be an object");
    }
    cfg.mcpServers = o.mcpServers as Record<string, unknown>;
  }
  if (o.safety !== undefined) {
    if (typeof o.safety !== "object" || o.safety === null || Array.isArray(o.safety)) {
      throw new ConfigError("safety must be an object");
    }
    const s = o.safety as Record<string, unknown>;
    cfg.safety = { allowCloud: s.allowCloud === true, allowAutoPr: s.allowAutoPr === true };
  }
  return cfg;
}
