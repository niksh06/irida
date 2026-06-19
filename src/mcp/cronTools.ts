/**
 * csagent-cron MCP tool handlers — propose jobs from chat (confirm via /schedule approve).
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveMemoryRoot } from "../config.js";
import { csagentMemoryDir, csagentStateDir } from "../env.js";
import {
  listCronJobsText,
  proposeUserCronJob,
  listPendingCronSchedulesText,
} from "../cronScheduleOps.js";

export interface CronMcpContext {
  dir: string;
  stateDir: string;
  gatewayChatId?: string;
  gatewayAdapter?: string;
}

export function resolveCronMcpContext(): CronMcpContext {
  const dir = csagentMemoryDir() ?? process.cwd();
  const stateDir = csagentStateDir() ?? resolveMemoryRoot(dir);
  const gatewayChatId = process.env.CSAGENT_GATEWAY_CHAT_ID?.trim() || undefined;
  const gatewayAdapter = process.env.CSAGENT_GATEWAY_ADAPTER?.trim() || "telegram";
  return { dir, stateDir, gatewayChatId, gatewayAdapter };
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function registerCronMcpTools(server: McpServer, ctx: CronMcpContext): void {
  server.registerTool(
    "cron_list",
    {
      description: "List scheduled csagent cron jobs (read-only).",
      inputSchema: {
        userOnly: z
          .boolean()
          .optional()
          .describe("If true, list only user-* jobs created from chat"),
      },
    },
    async ({ userOnly }) => {
      try {
        return textResult(listCronJobsText(ctx.dir, userOnly ? "user" : "all"));
      } catch (e) {
        return textResult(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.registerTool(
    "cron_propose",
    {
      description:
        "Propose a recurring cron job for this Telegram chat. User must confirm with /schedule approve <code>.",
      inputSchema: {
        id: z.string().describe("Job slug (will become user-<slug>)"),
        cron: z.string().describe("Five-field cron, local time, e.g. 0 9 * * 1"),
        prompt: z.string().describe("Agent prompt when job runs"),
        skills: z.array(z.string()).optional().describe("Optional skill names"),
      },
    },
    async ({ id, cron, prompt, skills }) => {
      if (!ctx.gatewayChatId) {
        return textResult(
          "cron_propose only works in gateway chat (CSAGENT_GATEWAY_CHAT_ID). Fallback: /schedule add …"
        );
      }
      const out = proposeUserCronJob(
        ctx.dir,
        { id, cron, prompt, skills },
        { chatId: ctx.gatewayChatId, adapter: ctx.gatewayAdapter ?? "telegram" }
      );
      return textResult(out.message);
    }
  );

  server.registerTool(
    "cron_pending",
    {
      description: "List pending cron proposals awaiting /schedule approve for this chat.",
      inputSchema: {},
    },
    async () => {
      const text = listPendingCronSchedulesText(ctx.dir, ctx.gatewayChatId);
      return textResult(text);
    }
  );
}
