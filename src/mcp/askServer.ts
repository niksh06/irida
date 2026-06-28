#!/usr/bin/env node
/**
 * stdio MCP server: csagent-ask — the agent's ask_user (park & resume) tool for
 * gateway chat (I-125). Spawned only when a gateway chat context is present.
 */
import { loadIridaEnv } from "../loadEnv.js";
loadIridaEnv();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAskMcpTools, resolveAskMcpContext } from "./askTools.js";

async function main(): Promise<void> {
  const ctx = resolveAskMcpContext();
  const server = new McpServer(
    { name: "csagent-ask", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
  registerAskMcpTools(server, ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
