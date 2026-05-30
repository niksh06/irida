import { loadConfig, validateMcpServers } from "../config.js";

export interface McpEntryView {
  name: string;
  kind: "stdio" | "http";
  target: string;
}

export function listMcpEntries(dir: string = process.cwd()): { entries: McpEntryView[]; errors: string[] } {
  const cfg = loadConfig(dir);
  const errors = validateMcpServers(cfg.mcpServers);
  const entries: McpEntryView[] = [];
  for (const [name, v] of Object.entries(cfg.mcpServers)) {
    if (typeof v !== "object" || v === null || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    if (typeof o.command === "string" && o.command.trim()) {
      const args = Array.isArray(o.args) ? o.args.join(" ") : "";
      entries.push({ name, kind: "stdio", target: `${o.command}${args ? " " + args : ""}`.slice(0, 60) });
    } else if (typeof o.url === "string" && o.url.trim()) {
      entries.push({ name, kind: "http", target: o.url.slice(0, 60) });
    }
  }
  return { entries, errors };
}
