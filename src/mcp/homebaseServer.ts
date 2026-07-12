#!/usr/bin/env node
/**
 * stdio MCP server: csagent-homebase — deterministic git-derived continuity +
 * situational-awareness for an Irida-spawned agent (I-159). arrive/whos_here/
 * handoff; no models, no cogit, no memory (see issues/I-159-homebase-continuity.md).
 */
import { loadIridaEnv } from "../loadEnv.js";
loadIridaEnv();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerHomebaseMcpTools, resolveHomebaseMcpContext } from "./homebaseTools.js";

async function main(): Promise<void> {
  const ctx = resolveHomebaseMcpContext();
  const server = new McpServer(
    { name: "csagent-homebase", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
  registerHomebaseMcpTools(server, ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
