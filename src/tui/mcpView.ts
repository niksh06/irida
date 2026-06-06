import { loadConfig, validateMcpServers } from "../config.js";
import { BROWSER_MCP_NAME, MEMORY_MCP_NAME, resolveMcpServers } from "../mcpServers.js";

export interface McpEntryView {
  name: string;
  kind: "stdio" | "http";
  target: string;
  builtin?: boolean;
}

export function listMcpEntries(dir: string = process.cwd()): { entries: McpEntryView[]; errors: string[] } {
  const cfg = loadConfig(dir);
  const merged = resolveMcpServers(cfg, dir);
  const errors = validateMcpServers(merged);
  const entries: McpEntryView[] = [];
  for (const [name, v] of Object.entries(merged)) {
    if (typeof v !== "object" || v === null || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    const builtin = name === MEMORY_MCP_NAME || name === BROWSER_MCP_NAME;
    if (typeof o.command === "string" && o.command.trim()) {
      const args = Array.isArray(o.args) ? o.args.join(" ") : "";
      entries.push({
        name,
        kind: "stdio",
        target: `${o.command}${args ? " " + args : ""}`.slice(0, 60),
        builtin,
      });
    } else if (typeof o.url === "string" && o.url.trim()) {
      entries.push({ name, kind: "http", target: o.url.slice(0, 60), builtin });
    }
  }
  return { entries, errors };
}
