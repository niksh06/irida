#!/usr/bin/env node
/**
 * stdio MCP server: csagent-memory tools for Cursor SDK agents.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerMemoryMcpTools, resolveMemoryMcpContext } from "./memoryTools.js";

async function main(): Promise<void> {
  const ctx = resolveMemoryMcpContext();
  const server = new McpServer(
    { name: "csagent-memory", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
  registerMemoryMcpTools(server, ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
