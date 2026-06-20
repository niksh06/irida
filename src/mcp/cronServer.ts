#!/usr/bin/env node
/**
 * stdio MCP server: csagent-cron scheduling tools for gateway chat.
 */
import { loadIridaEnv } from "../loadEnv.js";
loadIridaEnv();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCronMcpTools, resolveCronMcpContext } from "./cronTools.js";

async function main(): Promise<void> {
  const ctx = resolveCronMcpContext();
  const server = new McpServer(
    { name: "csagent-cron", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
  registerCronMcpTools(server, ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
