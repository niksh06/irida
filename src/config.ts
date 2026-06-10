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

/** Local embedding provider for semantic memory search (I-36, Ollama-compatible). */
export interface EmbeddingsConfig {
  /** Compute embeddings on note save + enable semantic search (default false). */
  enabled?: boolean;
  /** Ollama-compatible base URL (default http://127.0.0.1:11434). */
  url?: string;
  /** Embedding model name (default nomic-embed-text). */
  model?: string;
}

/** Durable memory injected before the first turn of each chat session (issue 036). */
export interface MemoryConfig {
  /** Optional: inject named notes on first turn only (prefer MCP tools). */
  onStart?: string[];
  /** Total chars cap for onStart injection (default 32 KiB). */
  maxCharsPerTurn?: number;
  /** Attach csagent-memory MCP tools (default true). Set false to disable. */
  mcp?: boolean;
  /** Local embeddings for semantic search (Postgres + pgvector only). */
  embeddings?: EmbeddingsConfig;
}

/** Stealth browser MCP (puppeteer-extra + persistent Chromium profile). */
export interface BrowserConfig {
  /** Attach csagent-browser MCP tools (default false). Set true to enable. */
  mcp?: boolean;
  /** Chromium user-data profile name under `<state>/browser/` (default `default`). */
  profile?: string;
  /** Headless mode for agent runs (default true). Set false for manual login flows. */
  headless?: boolean;
  /** Optional custom User-Agent string. */
  userAgent?: string;
  /** Optional Chrome/Chromium executable path (or CSAGENT_CHROME_PATH env). */
  chromePath?: string;
}

export interface AgentConfig {
  model: string;
  runtime: "local" | "cloud";
  cwd: string;
  skillsPath: string;
  stateDir: string;
  mcpServers: Record<string, unknown>;
  safety: SafetyConfig;
  memory: MemoryConfig;
  browser: BrowserConfig;
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

/** Canonical `.agent` directory for memory, credentials, cron state. */
export function resolveMemoryRoot(projectDir: string = process.cwd()): string {
  const home = csagentHome();
  if (home) return resolve(home, ".agent");
  const cfg = loadConfig(projectDir);
  const stateDir = cfg.stateDir;
  if (stateDir.startsWith("/") || /^[A-Za-z]:[\\/]/.test(stateDir)) return stateDir;
  return resolve(projectDir, stateDir);
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
    memory: {},
    browser: {},
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
  if (o.memory !== undefined) {
    if (typeof o.memory !== "object" || o.memory === null || Array.isArray(o.memory)) {
      throw new ConfigError("memory must be an object");
    }
    const m = o.memory as Record<string, unknown>;
    if (m.onStart !== undefined) {
      if (!Array.isArray(m.onStart) || !m.onStart.every((x) => typeof x === "string")) {
        throw new ConfigError("memory.onStart must be an array of strings");
      }
      cfg.memory.onStart = m.onStart.map((x) => x.trim()).filter(Boolean);
    }
    if (m.maxCharsPerTurn !== undefined) {
      if (typeof m.maxCharsPerTurn !== "number" || m.maxCharsPerTurn < 256) {
        throw new ConfigError("memory.maxCharsPerTurn must be a number >= 256");
      }
      cfg.memory.maxCharsPerTurn = m.maxCharsPerTurn;
    }
    if (m.mcp !== undefined) {
      if (typeof m.mcp !== "boolean") {
        throw new ConfigError("memory.mcp must be a boolean");
      }
      cfg.memory.mcp = m.mcp;
    }
    if (m.embeddings !== undefined) {
      if (typeof m.embeddings !== "object" || m.embeddings === null || Array.isArray(m.embeddings)) {
        throw new ConfigError("memory.embeddings must be an object");
      }
      const e = m.embeddings as Record<string, unknown>;
      const emb: EmbeddingsConfig = {};
      if (e.enabled !== undefined) {
        if (typeof e.enabled !== "boolean") throw new ConfigError("memory.embeddings.enabled must be a boolean");
        emb.enabled = e.enabled;
      }
      if (e.url !== undefined) {
        if (typeof e.url !== "string" || !e.url.trim()) {
          throw new ConfigError("memory.embeddings.url must be a non-empty string");
        }
        emb.url = e.url.trim();
      }
      if (e.model !== undefined) {
        if (typeof e.model !== "string" || !e.model.trim()) {
          throw new ConfigError("memory.embeddings.model must be a non-empty string");
        }
        emb.model = e.model.trim();
      }
      cfg.memory.embeddings = emb;
    }
  }
  if (o.browser !== undefined) {
    if (typeof o.browser !== "object" || o.browser === null || Array.isArray(o.browser)) {
      throw new ConfigError("browser must be an object");
    }
    const b = o.browser as Record<string, unknown>;
    if (b.mcp !== undefined) {
      if (typeof b.mcp !== "boolean") throw new ConfigError("browser.mcp must be a boolean");
      cfg.browser.mcp = b.mcp;
    }
    if (b.profile !== undefined) {
      if (typeof b.profile !== "string" || !b.profile.trim()) {
        throw new ConfigError("browser.profile must be a non-empty string");
      }
      cfg.browser.profile = b.profile.trim();
    }
    if (b.headless !== undefined) {
      if (typeof b.headless !== "boolean") throw new ConfigError("browser.headless must be a boolean");
      cfg.browser.headless = b.headless;
    }
    if (b.userAgent !== undefined) {
      if (typeof b.userAgent !== "string" || !b.userAgent.trim()) {
        throw new ConfigError("browser.userAgent must be a non-empty string");
      }
      cfg.browser.userAgent = b.userAgent.trim();
    }
    if (b.chromePath !== undefined) {
      if (typeof b.chromePath !== "string" || !b.chromePath.trim()) {
        throw new ConfigError("browser.chromePath must be a non-empty string");
      }
      cfg.browser.chromePath = b.chromePath.trim();
    }
  }
  return cfg;
}
