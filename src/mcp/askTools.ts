/**
 * csagent-ask MCP tool handlers — the agent asks the human user a clarifying
 * question and PARKS the turn (I-125). The tool runs as a stdio subprocess with
 * the chat context in its env (CSAGENT_GATEWAY_CHAT_ID/ADAPTER, CSAGENT_*), so
 * it can persist a pending question to the shared store the gateway reads. It
 * cannot reach Telegram itself — the question reaches the user as the agent's
 * final turn message; the answer flows back via the gateway's per-peer resume.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveMemoryRoot } from "../config.js";
import {
  iridaMemoryDir,
  iridaStateDir,
  iridaGatewayChatId,
  iridaGatewayAdapter,
} from "../env.js";
import { setPendingQuestion } from "../gatewayPendingQuestionStore.js";
import { addFollowup, FOLLOWUP_MAX_AFTER_MINUTES } from "../gatewayFollowupStore.js";

export interface AskMcpContext {
  dir: string;
  stateDir: string;
  gatewayChatId?: string;
  gatewayAdapter?: string;
}

export function resolveAskMcpContext(): AskMcpContext {
  const dir = iridaMemoryDir() ?? process.cwd();
  const stateDir = iridaStateDir() ?? resolveMemoryRoot(dir);
  const gatewayChatId = iridaGatewayChatId();
  const gatewayAdapter = iridaGatewayAdapter() || "telegram";
  return { dir, stateDir, gatewayChatId, gatewayAdapter };
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function registerAskMcpTools(server: McpServer, ctx: AskMcpContext): void {
  server.registerTool(
    "ask_user",
    {
      description:
        "Ask the human user a clarifying question and PAUSE for their answer. " +
        "Use this only when you genuinely need input to proceed and must NOT guess. " +
        "Calling this delivers your question to the user and ENDS your current turn: " +
        "their reply arrives as a NEW message in a later turn, not now. After calling " +
        "ask_user, stop immediately — restate the question as your final message and end " +
        "the turn. Do not keep working and do not assume an answer.",
      inputSchema: {
        question: z
          .string()
          .min(1)
          .describe("The question to ask the user, in plain text."),
      },
    },
    async ({ question }) => {
      const q = question.trim();
      if (!q) return textResult("ask_user: empty question — nothing to ask.");
      if (!ctx.gatewayChatId) {
        // Not a gateway chat (no chat to deliver to / no resume) — degrade to
        // asking inline rather than parking a question nobody will answer.
        return textResult(
          "ask_user is only available in gateway chat. Just ask your question directly in your reply."
        );
      }
      setPendingQuestion(ctx.dir, {
        chatId: ctx.gatewayChatId,
        adapter: ctx.gatewayAdapter ?? "telegram",
        question: q,
      });
      return textResult(
        "Question delivered to the user. END YOUR TURN NOW — restate the question as your " +
          "final message and stop. The user's reply will arrive as your next message; do not " +
          "assume an answer."
      );
    }
  );

  server.registerTool(
    "defer_followup",
    {
      description:
        "Defer work and proactively come back to the user LATER. Use when you tell the user " +
        "you'll return with a result after some time (a build/deploy to finish, something to " +
        "re-check, 'I'll get back to you in N min'). Calling this schedules a ONE-SHOT " +
        "self-resume: after ~after_minutes you are re-run to do/check the work and the result " +
        "is messaged to the user automatically — no poke needed. The `reason` MUST be " +
        "SELF-CONTAINED (what to do/check AND what to report), because the follow-up runs in a " +
        "FRESH turn that sees ONLY this text — not the current conversation. After calling, END " +
        "your turn with an honest ack ('working on X, I'll message you in ~N min'); do not " +
        "assume the result now. Resolution is ~5 min. For RECURRING schedules use cron " +
        "(/schedule), not this.",
      inputSchema: {
        reason: z
          .string()
          .min(1)
          .describe(
            "Self-contained description of what to do/check and what to report. The follow-up " +
              "turn sees ONLY this — include any command, path, or context it needs."
          ),
        after_minutes: z
          .number()
          .int()
          .min(1)
          .max(FOLLOWUP_MAX_AFTER_MINUTES)
          .describe(`Delay before coming back, in minutes (1..${FOLLOWUP_MAX_AFTER_MINUTES}).`),
      },
    },
    async ({ reason, after_minutes }) => {
      if (!ctx.gatewayChatId) {
        return textResult(
          "defer_followup is only available in gateway chat. Do the work inline and reply now instead."
        );
      }
      const out = addFollowup(ctx.dir, {
        chatId: ctx.gatewayChatId,
        adapter: ctx.gatewayAdapter ?? "telegram",
        reason: reason.trim(),
        afterMinutes: after_minutes,
      });
      if (!out.ok) return textResult(`defer_followup: ${out.error}`);
      return textResult(
        `Follow-up scheduled (~${after_minutes} min, id ${out.followup!.id}). END YOUR TURN NOW ` +
          `with an honest ack to the user (e.g. "working on it — I'll message you in ~${after_minutes} ` +
          `min with the result"). Do not assume or fabricate the result now.`
      );
    }
  );
}
