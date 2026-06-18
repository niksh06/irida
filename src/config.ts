/**
 * Project-local config (issue 003/004): ./agent.config.json + defaults.
 * Secrets NEVER live here — CURSOR_API_KEY comes from the environment.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { csagentHome } from "./env.js";

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

/** Silent memory retrieval before each turn (Wave B auto-RAG). */
export interface AutoRagConfig {
  /** When true, search memory for the user message and prepend top hits. */
  enabled?: boolean;
  /** Max notes to inject (default 3, max 10). */
  limit?: number;
  /** Prefer semantic search when embeddings are enabled (FTS fallback). */
  semantic?: boolean;
  /** Total chars cap for injected note bodies (default 12 KiB). */
  maxChars?: number;
  /** Restrict to these wings (default: all except secure). */
  wings?: string[];
}

/** Built-in turn context: profile excerpt + mode env fallback (I-52). */
export interface PreTurnConfig {
  /** Memory note name for profile excerpt (e.g. user-profile.niksh). */
  profileNote?: string;
  /** Max chars for profile excerpt (default 1500). */
  profileMaxChars?: number;
  /** Env var for mode when message has no ADVICE:/DO: prefix (default CSAGENT_MODE). */
  modeEnv?: string;
}

/** Optional hook script (I-47). */
export interface HookScriptConfig {
  command: string;
  timeoutMs?: number;
}

export interface HooksConfig {
  preTurn?: HookScriptConfig;
  postTurn?: HookScriptConfig;
}

export interface SkillPolicyConfig {
  allowUnsafe?: string[];
}

/** Hybrid FTS + vector search tuning (I-72). */
export interface MemorySearchConfig {
  hybridWeights?: { fts?: number; vector?: number };
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
  /** Silent memory_search before each turn — inject top matching notes. */
  autoRag?: AutoRagConfig;
  /** Mode prefix + profile excerpt before each turn (I-52). */
  preTurn?: PreTurnConfig;
  /** Wings omitted from FTS/semantic search unless includeArchive/includeEpisodic (default: cursor-ide, secure, episodic). */
  searchExcludeWings?: string[];
  /** Wings skipped by embed-on-save and reindex-embeddings (default: cursor-ide, secure). */
  embedExcludeWings?: string[];
  /** Hybrid search weights and related options (Postgres + embeddings). */
  search?: MemorySearchConfig;
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
  hooks?: HooksConfig;
  skillPolicy?: SkillPolicyConfig;
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

/** Runtime home (~/.csagent): credentials, gateway, sqlite, memory. Defined in
 * the env leaf (Arch-4); re-exported for existing `from "./config.js"` imports. */
export { csagentHome };

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
    if (m.autoRag !== undefined) {
      if (typeof m.autoRag !== "object" || m.autoRag === null || Array.isArray(m.autoRag)) {
        throw new ConfigError("memory.autoRag must be an object");
      }
      const a = m.autoRag as Record<string, unknown>;
      const autoRag: AutoRagConfig = {};
      if (a.enabled !== undefined) {
        if (typeof a.enabled !== "boolean") throw new ConfigError("memory.autoRag.enabled must be a boolean");
        autoRag.enabled = a.enabled;
      }
      if (a.limit !== undefined) {
        if (typeof a.limit !== "number" || a.limit < 1) {
          throw new ConfigError("memory.autoRag.limit must be a number >= 1");
        }
        autoRag.limit = a.limit;
      }
      if (a.semantic !== undefined) {
        if (typeof a.semantic !== "boolean") {
          throw new ConfigError("memory.autoRag.semantic must be a boolean");
        }
        autoRag.semantic = a.semantic;
      }
      if (a.maxChars !== undefined) {
        if (typeof a.maxChars !== "number" || a.maxChars < 512) {
          throw new ConfigError("memory.autoRag.maxChars must be a number >= 512");
        }
        autoRag.maxChars = a.maxChars;
      }
      if (a.wings !== undefined) {
        if (!Array.isArray(a.wings) || !a.wings.every((w) => typeof w === "string")) {
          throw new ConfigError("memory.autoRag.wings must be an array of strings");
        }
        autoRag.wings = a.wings.map((w) => w.trim()).filter(Boolean);
      }
      cfg.memory.autoRag = autoRag;
    }
    if (m.search !== undefined) {
      if (typeof m.search !== "object" || m.search === null || Array.isArray(m.search)) {
        throw new ConfigError("memory.search must be an object");
      }
      const s = m.search as Record<string, unknown>;
      const search: MemorySearchConfig = {};
      if (s.hybridWeights !== undefined) {
        if (typeof s.hybridWeights !== "object" || s.hybridWeights === null || Array.isArray(s.hybridWeights)) {
          throw new ConfigError("memory.search.hybridWeights must be an object");
        }
        const hw = s.hybridWeights as Record<string, unknown>;
        const hybridWeights: { fts?: number; vector?: number } = {};
        if (hw.fts !== undefined) {
          if (typeof hw.fts !== "number" || hw.fts <= 0) {
            throw new ConfigError("memory.search.hybridWeights.fts must be a number > 0");
          }
          hybridWeights.fts = hw.fts;
        }
        if (hw.vector !== undefined) {
          if (typeof hw.vector !== "number" || hw.vector <= 0) {
            throw new ConfigError("memory.search.hybridWeights.vector must be a number > 0");
          }
          hybridWeights.vector = hw.vector;
        }
        search.hybridWeights = hybridWeights;
      }
      cfg.memory.search = search;
    }
    if (m.preTurn !== undefined) {
      if (typeof m.preTurn !== "object" || m.preTurn === null || Array.isArray(m.preTurn)) {
        throw new ConfigError("memory.preTurn must be an object");
      }
      const p = m.preTurn as Record<string, unknown>;
      const preTurn: PreTurnConfig = {};
      if (p.profileNote !== undefined) {
        if (typeof p.profileNote !== "string" || !p.profileNote.trim()) {
          throw new ConfigError("memory.preTurn.profileNote must be a non-empty string");
        }
        preTurn.profileNote = p.profileNote.trim();
      }
      if (p.profileMaxChars !== undefined) {
        if (typeof p.profileMaxChars !== "number" || p.profileMaxChars < 256) {
          throw new ConfigError("memory.preTurn.profileMaxChars must be a number >= 256");
        }
        preTurn.profileMaxChars = p.profileMaxChars;
      }
      if (p.modeEnv !== undefined) {
        if (typeof p.modeEnv !== "string" || !p.modeEnv.trim()) {
          throw new ConfigError("memory.preTurn.modeEnv must be a non-empty string");
        }
        preTurn.modeEnv = p.modeEnv.trim();
      }
      cfg.memory.preTurn = preTurn;
    }
    for (const key of ["searchExcludeWings", "embedExcludeWings"] as const) {
      const raw = m[key];
      if (raw === undefined) continue;
      if (!Array.isArray(raw) || !raw.every((x) => typeof x === "string")) {
        throw new ConfigError(`memory.${key} must be an array of strings`);
      }
      cfg.memory[key] = raw.map((x) => x.trim()).filter(Boolean);
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
  if (o.hooks !== undefined) {
    if (typeof o.hooks !== "object" || o.hooks === null || Array.isArray(o.hooks)) {
      throw new ConfigError("hooks must be an object");
    }
    const h = o.hooks as Record<string, unknown>;
    const hooks: HooksConfig = {};
    for (const key of ["preTurn", "postTurn"] as const) {
      const raw = h[key];
      if (raw === undefined) continue;
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new ConfigError(`hooks.${key} must be an object`);
      }
      const hook = raw as Record<string, unknown>;
      const command = typeof hook.command === "string" ? hook.command.trim() : "";
      if (!command) throw new ConfigError(`hooks.${key}.command must be a non-empty string`);
      const parsed: HookScriptConfig = { command };
      if (hook.timeoutMs !== undefined) {
        if (typeof hook.timeoutMs !== "number" || hook.timeoutMs < 100) {
          throw new ConfigError(`hooks.${key}.timeoutMs must be a number >= 100`);
        }
        parsed.timeoutMs = hook.timeoutMs;
      }
      hooks[key] = parsed;
    }
    cfg.hooks = hooks;
  }
  if (o.skillPolicy !== undefined) {
    if (typeof o.skillPolicy !== "object" || o.skillPolicy === null || Array.isArray(o.skillPolicy)) {
      throw new ConfigError("skillPolicy must be an object");
    }
    const sp = o.skillPolicy as Record<string, unknown>;
    if (sp.allowUnsafe !== undefined) {
      if (!Array.isArray(sp.allowUnsafe) || !sp.allowUnsafe.every((x) => typeof x === "string")) {
        throw new ConfigError("skillPolicy.allowUnsafe must be an array of strings");
      }
      cfg.skillPolicy = {
        allowUnsafe: sp.allowUnsafe.map((x) => x.trim()).filter(Boolean),
      };
    }
  }
  return cfg;
}
