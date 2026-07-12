/**
 * csagent-homebase MCP tool handlers (I-159): deterministic git-derived
 * continuity + situational-awareness. arrive/whos_here are read-only;
 * handoff is the only tool that writes state.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, resolveMemoryRoot, type AgentConfig } from "../config.js";
import { iridaMemoryDir, iridaStateDir } from "../env.js";
import { arrive, whosHere, handoff, formatArriveBriefing, formatWhosHereBriefing } from "../homebase.js";

export interface HomebaseMcpContext {
  dir: string;
  stateDir: string;
  cfg: AgentConfig;
}

export function resolveHomebaseMcpContext(): HomebaseMcpContext {
  const dir = iridaMemoryDir() ?? process.cwd();
  const stateDir = iridaStateDir() ?? resolveMemoryRoot(dir);
  const cfg = loadConfig(dir);
  return { dir, stateDir, cfg };
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function registerHomebaseMcpTools(server: McpServer, ctx: HomebaseMcpContext): void {
  server.registerTool(
    "arrive",
    {
      description:
        "Call this once at the start of a session (or any time mid-session you want a fresh " +
        "situational briefing): per-repo git state (branch/dirty/ahead-behind), what changed " +
        "since your last handoff (with foreign-commit attribution), and open threads from your " +
        "last handoff. Read-only — call handoff() before ending your turn to checkpoint what " +
        "you saw.",
      inputSchema: {
        project: z.string().optional().describe("Absolute repo path; defaults to this agent's configured project directory."),
      },
    },
    async ({ project }) => {
      try {
        const result = await arrive({
          dir: ctx.dir,
          cfg: ctx.cfg,
          stateDir: ctx.stateDir,
          repoPath: project?.trim() || ctx.dir,
        });
        return textResult(formatArriveBriefing(result));
      } catch (e) {
        return textResult(`arrive failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  server.registerTool(
    "whos_here",
    {
      description:
        "Check for OTHER activity in this repo since your last handoff — commits NOT authored " +
        "by you (email from git config), plus current dirty/staged state. Catches parallel " +
        "agents/humans (including non-Irida tools) working the same tree. Read-only.",
      inputSchema: {
        repo: z.string().optional().describe("Absolute repo path; defaults to this agent's configured project directory."),
      },
    },
    async ({ repo }) => {
      try {
        const result = await whosHere({
          dir: ctx.dir,
          stateDir: ctx.stateDir,
          repoPath: repo?.trim() || ctx.dir,
        });
        return textResult(formatWhosHereBriefing(result));
      } catch (e) {
        return textResult(`whos_here failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  server.registerTool(
    "handoff",
    {
      description:
        "Call this at the end of your turn/session to checkpoint your position: records open " +
        "threads and the current HEAD so the NEXT arrive() diffs from here. This is the ONLY " +
        "homebase tool that writes state — arrive/whos_here never do.",
      inputSchema: {
        summary: z.string().min(1).describe("Free-text handoff note: what you were doing, what's uncommitted, what's next."),
        open_threads: z
          .array(z.string())
          .optional()
          .describe("Open threads/TODOs to carry forward. Omit to leave the previously recorded list unchanged."),
        repo: z.string().optional().describe("Absolute repo path; defaults to this agent's configured project directory."),
      },
    },
    async ({ summary, open_threads, repo }) => {
      try {
        await handoff({
          dir: ctx.dir,
          stateDir: ctx.stateDir,
          repoPath: repo?.trim() || ctx.dir,
          summary,
          openThreads: open_threads,
        });
        return textResult("Handoff recorded. Next arrive() will diff from this point.");
      } catch (e) {
        return textResult(`handoff failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );
}
