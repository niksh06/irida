/**
 * Merge user MCP servers with built-in csagent-memory (Phase 2).
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentConfig } from "./config.js";
import type { McpServers } from "./host.js";

export const MEMORY_MCP_NAME = "csagent-memory";

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

export function memoryMcpEnabled(cfg: AgentConfig): boolean {
  return cfg.memory?.mcp !== false;
}

/** MCP servers passed to Cursor SDK (includes csagent-memory unless disabled). */
export function resolveMcpServers(cfg: AgentConfig, projectDir: string): McpServers {
  const merged: McpServers = { ...cfg.mcpServers };
  if (!memoryMcpEnabled(cfg)) return merged;
  if (MEMORY_MCP_NAME in merged) return merged;

  const stateDir = resolve(projectDir, cfg.stateDir);
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
  return merged;
}
