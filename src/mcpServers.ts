/**
 * Merge user MCP servers with built-in csagent-memory and csagent-browser.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_BROWSER_PROFILE } from "./browser/defaults.js";
import type { AgentConfig } from "./config.js";
import { resolveBrowserRoot } from "./mcp/browserContext.js";
import type { McpServers } from "./host.js";

export const MEMORY_MCP_NAME = "csagent-memory";
export const BROWSER_MCP_NAME = "csagent-browser";

const CODE_ROOT = dirname(fileURLToPath(import.meta.url));

function memoryServerEntry(projectDir: string): { command: string; args: string[] } {
  const roots = [
    process.env.CSAGENT_ROOT?.trim(),
    projectDir,
    join(CODE_ROOT, ".."),
  ].filter(Boolean) as string[];

  for (const root of roots) {
    const dist = join(root, "dist/mcp/memoryServer.js");
    if (existsSync(dist)) {
      return { command: process.execPath, args: [dist] };
    }
    const src = join(root, "src/mcp/memoryServer.ts");
    const tsx = join(root, "node_modules/.bin/tsx");
    if (existsSync(src) && existsSync(tsx)) {
      return { command: tsx, args: [src] };
    }
  }

  const fallback = join(CODE_ROOT, "mcp/memoryServer.js");
  return { command: process.execPath, args: [fallback] };
}

function browserServerEntry(projectDir: string): { command: string; args: string[] } {
  const roots = [
    process.env.CSAGENT_ROOT?.trim(),
    projectDir,
    join(CODE_ROOT, ".."),
  ].filter(Boolean) as string[];

  for (const root of roots) {
    const dist = join(root, "dist/mcp/browserServer.js");
    if (existsSync(dist)) {
      return { command: process.execPath, args: [dist] };
    }
    const src = join(root, "src/mcp/browserServer.ts");
    const tsx = join(root, "node_modules/.bin/tsx");
    if (existsSync(src) && existsSync(tsx)) {
      return { command: tsx, args: [src] };
    }
  }

  const fallback = join(CODE_ROOT, "mcp/browserServer.js");
  return { command: process.execPath, args: [fallback] };
}

export function memoryMcpEnabled(cfg: AgentConfig): boolean {
  return cfg.memory?.mcp !== false;
}

export function browserMcpEnabled(cfg: AgentConfig): boolean {
  return cfg.browser?.mcp === true;
}

/** MCP servers passed to Cursor SDK (includes built-ins unless disabled). */
export function resolveMcpServers(cfg: AgentConfig, projectDir: string): McpServers {
  const merged: McpServers = { ...cfg.mcpServers };
  const stateDir = resolve(projectDir, cfg.stateDir);

  if (memoryMcpEnabled(cfg) && !(MEMORY_MCP_NAME in merged)) {
    const { command, args } = memoryServerEntry(projectDir);
    merged[MEMORY_MCP_NAME] = {
      command,
      args,
      env: {
        CSAGENT_MEMORY_DIR: resolve(projectDir),
        CSAGENT_STATE_DIR: stateDir,
        ...(process.env.CSAGENT_HOME ? { CSAGENT_HOME: process.env.CSAGENT_HOME } : {}),
        ...(process.env.CSAGENT_DATABASE_URL
          ? { CSAGENT_DATABASE_URL: process.env.CSAGENT_DATABASE_URL }
          : {}),
      },
    };
  }

  if (browserMcpEnabled(cfg) && !(BROWSER_MCP_NAME in merged)) {
    const { command, args } = browserServerEntry(projectDir);
    const profile = cfg.browser?.profile?.trim() || DEFAULT_BROWSER_PROFILE;
    merged[BROWSER_MCP_NAME] = {
      command,
      args,
      env: {
        CSAGENT_MEMORY_DIR: resolve(projectDir),
        CSAGENT_BROWSER_ROOT: resolveBrowserRoot(projectDir),
        CSAGENT_BROWSER_PROFILE: profile,
        CSAGENT_BROWSER_HEADLESS: cfg.browser?.headless === false ? "false" : "true",
        ...(cfg.browser?.chromePath ? { CSAGENT_CHROME_PATH: cfg.browser.chromePath } : {}),
        ...(process.env.CSAGENT_HOME ? { CSAGENT_HOME: process.env.CSAGENT_HOME } : {}),
      },
    };
  }

  return merged;
}
