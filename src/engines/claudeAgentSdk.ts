/**
 * Claude Agent SDK engine adapter (Irida / I-100).
 *
 * Wraps `@anthropic-ai/claude-agent-sdk` behind the same interfaces the Cursor
 * SDK satisfies (SdkLike for one-shot `run`; SdkCreateLike + SdkResumeLike +
 * AgentLike for interactive `chat`/`resume`), so all surfaces share one path.
 * The Agent SDK is a full agent runtime (its own loop, tools, MCP) — selecting
 * it is the second engine, not a completion fallback.
 *
 * Auth (two modes, per engine.auth):
 *  - "api-key": Anthropic API key via env ANTHROPIC_API_KEY.
 *  - "account": Claude subscription via env CLAUDE_CODE_OAUTH_TOKEN (from
 *    `claude setup-token`), or — when no token is supplied — an existing
 *    `claude login` session the bundled binary reads from the OS keychain /
 *    ~/.claude/.credentials.json.
 * `applyEngineAuthEnv` sets one credential and clears the other for the call.
 *
 * Session identity: the Agent SDK's `session_id` is our `agentId`. We persist it
 * across turns (closure) and pass it as `resume` on the next `query()`.
 */
import type {
  SdkLike,
  SdkPromptResult,
  SdkCreateLike,
  SdkResumeLike,
  AgentLike,
  RunLike,
  McpServers,
  AgentSendOptions,
  StreamUsage,
} from "../host.js";
import { parseStreamUsage } from "../host.js";
import type { EngineAuth } from "../config.js";
import { DEFAULT_CLAUDE_AGENT_MODEL } from "../config.js";
import { destructiveReason } from "../safety.js";

export type ClaudeAgentSdk = SdkLike & SdkCreateLike & SdkResumeLike;

/** Resolved tool-permission policy handed to the engine (I-94). */
export interface EngineToolPolicy {
  /** Deny destructive tool inputs at runtime via `canUseTool`. */
  denyDestructive: boolean;
}

type ToolDecision =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string };

/**
 * Vet a single tool call's input for a destructive shell pattern (I-94). Scans
 * every string field (the Bash `command`, an Edit path, …) with the shared
 * `safety.ts` denylist. Pure + exported for unit tests; the SDK `canUseTool`
 * callback is a thin async wrapper over this.
 *
 * The allow branch MUST echo the tool input back as `updatedInput`: the Agent
 * SDK validates the PermissionResult with a Zod schema that requires
 * `updatedInput` to be a record for `behavior: "allow"` (the TS type marks it
 * optional, but the runtime rejects `undefined` — every approval-gated tool
 * (Write/Edit/curl/WebFetch/non-preapproved Bash) fails with a union ZodError
 * otherwise, which silently breaks the whole gated agent).
 */
export function evaluateToolInput(input: Record<string, unknown>): ToolDecision {
  for (const v of Object.values(input)) {
    if (typeof v !== "string") continue;
    const hit = destructiveReason(v);
    if (hit) {
      return { behavior: "deny", message: `irida tool-policy: blocked destructive tool input (${hit})` };
    }
  }
  return { behavior: "allow", updatedInput: input };
}

function restoreEnv(name: string, prev: string | undefined): void {
  if (prev === undefined) delete process.env[name];
  else process.env[name] = prev;
}

/**
 * Point the Agent SDK at exactly one credential for the duration of a call, then
 * restore. `secret` may be empty in account mode → rely on the `claude login`
 * session. Returns a restore thunk; always call it in `finally`.
 */
export function applyEngineAuthEnv(authMode: EngineAuth, secret: string): () => void {
  const prevApiKey = process.env.ANTHROPIC_API_KEY;
  const prevOauth = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (authMode === "account") {
    // API key would take precedence over account auth — clear it for this call.
    delete process.env.ANTHROPIC_API_KEY;
    if (secret) process.env.CLAUDE_CODE_OAUTH_TOKEN = secret;
    // empty secret → leave any inherited token / fall back to `claude login`.
  } else {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    if (secret) process.env.ANTHROPIC_API_KEY = secret;
  }
  return () => {
    restoreEnv("ANTHROPIC_API_KEY", prevApiKey);
    restoreEnv("CLAUDE_CODE_OAUTH_TOKEN", prevOauth);
  };
}

/** Map irida MCP entries ({command}|{url}) to Agent SDK McpServerConfig. */
export function toAgentMcpServers(mcp?: McpServers): Record<string, unknown> | undefined {
  if (!mcp) return undefined;
  const out: Record<string, unknown> = {};
  for (const [name, v] of Object.entries(mcp)) {
    const o = v as { command?: unknown; args?: unknown; env?: unknown; url?: unknown; headers?: unknown };
    if (typeof o?.command === "string" && o.command.trim()) {
      out[name] = {
        type: "stdio",
        command: o.command,
        ...(Array.isArray(o.args) ? { args: o.args } : {}),
        ...(o.env && typeof o.env === "object" ? { env: o.env } : {}),
      };
    } else if (typeof o?.url === "string" && o.url.trim()) {
      out[name] = { type: "http", url: o.url, ...(o.headers && typeof o.headers === "object" ? { headers: o.headers } : {}) };
    }
    // Entries matching neither shape are dropped (logged by the caller's MCP validation).
  }
  return Object.keys(out).length ? out : undefined;
}

type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: Record<string, unknown>
) => Promise<ToolDecision>;

type QueryOptions = {
  model: string;
  cwd: string;
  permissionMode: string;
  canUseTool?: CanUseTool;
  mcpServers?: Record<string, unknown>;
  resume?: string;
  disallowedTools?: string[];
};

/**
 * Permission options for a `query()` call (I-94). Gate OFF → keep the prior
 * `bypassPermissions` (no behavior change). Gate ON → `default` mode so the SDK
 * routes tool calls through `canUseTool`, which allows everything except
 * destructive inputs. `canUseTool` runs every turn and survives `resume`.
 */
function permissionOptions(denyDestructive: boolean): Pick<QueryOptions, "permissionMode" | "canUseTool"> {
  if (!denyDestructive) return { permissionMode: "bypassPermissions" };
  return {
    permissionMode: "default",
    canUseTool: async (toolName, input) => {
      const decision = evaluateToolInput(input);
      if (decision.behavior === "deny") {
        // Lands in stderr → gateway.error.log for the autonomous surfaces.
        console.error(`[tool-policy] deny ${toolName}: ${decision.message}`);
      }
      return decision;
    },
  };
}

async function startQuery(message: string, options: QueryOptions): Promise<AsyncIterable<Record<string, unknown>>> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  return query({ prompt: message, options } as Parameters<typeof query>[0]) as AsyncIterable<Record<string, unknown>>;
}

/** Drain an Agent SDK message stream into the SdkLike one-shot result shape. */
async function collectOneShot(q: AsyncIterable<Record<string, unknown>>): Promise<SdkPromptResult> {
  let resultText = "";
  let sessionId: string | undefined;
  let isError = false;
  let usage: StreamUsage | undefined;
  for await (const m of q) {
    if (typeof m.session_id === "string") sessionId = m.session_id;
    const u = parseStreamUsage(m);
    if (u) usage = { ...usage, ...u };
    if (m.type === "result") {
      isError = Boolean(m.is_error);
      if (typeof m.result === "string") resultText = m.result;
    }
  }
  return {
    status: isError ? "error" : "finished",
    result: resultText,
    id: sessionId,
    agentId: sessionId,
    ...(usage ? { usage } : {}),
  };
}

export function createClaudeAgentSdk(opts?: {
  authMode?: EngineAuth;
  toolPolicy?: EngineToolPolicy;
}): ClaudeAgentSdk {
  const authMode: EngineAuth = opts?.authMode ?? "api-key";
  const denyDestructive = opts?.toolPolicy?.denyDestructive ?? false;

  /** Interactive agent handle: one Agent SDK session, resumed per turn. */
  function makeAgent(init: {
    model: string;
    cwd: string;
    apiKey: string;
    mcpServers?: Record<string, unknown>;
    sessionId?: string;
  }): AgentLike {
    let sessionId = init.sessionId;
    const agent: AgentLike = {
      agentId: sessionId,
      async send(message: string, sendOpts?: AgentSendOptions): Promise<RunLike> {
        const model = sendOpts?.model?.id?.trim() || init.model;
        const restore = applyEngineAuthEnv(authMode, init.apiKey);
        let q: AsyncIterable<Record<string, unknown>>;
        try {
          q = await startQuery(message, {
            model,
            cwd: init.cwd,
            ...permissionOptions(denyDestructive),
            ...(init.mcpServers ? { mcpServers: init.mcpServers } : {}),
            ...(sessionId ? { resume: sessionId } : {}),
          });
        } catch (e) {
          restore();
          throw e;
        }

        let status = "finished";
        let sid = sessionId;
        let errorDetail: string | undefined;
        let finished = false;
        let resolveWait: () => void = () => {};
        const waitP = new Promise<void>((r) => (resolveWait = r));

        const run: RunLike = {
          async *stream() {
            try {
              for await (const m of q) {
                if (typeof m.session_id === "string") {
                  sid = m.session_id;
                  agent.agentId = sid;
                }
                if (m.type === "result") {
                  const isErr = Boolean(m.is_error);
                  status = isErr ? "error" : "finished";
                  if (isErr) {
                    const subtype = typeof m.subtype === "string" ? m.subtype : "";
                    const txt = typeof m.result === "string" ? m.result : "";
                    errorDetail = [subtype, txt].filter(Boolean).join(": ") || "agent run error";
                  }
                }
                yield m;
              }
            } finally {
              sessionId = sid; // persist for the next turn's resume
              finished = true;
              resolveWait();
              restore();
            }
          },
          async wait() {
            if (!finished) await waitP;
            // `error` is read by pickRunErrorDetail() so chat surfaces a useful detail.
            const out: { status: string; id?: string; error?: string } = { status, id: sid };
            if (errorDetail) out.error = errorDetail;
            return out;
          },
        };
        return run;
      },
    };
    return agent;
  }

  return {
    async prompt(message, sdkOpts): Promise<SdkPromptResult> {
      const restore = applyEngineAuthEnv(authMode, sdkOpts.apiKey ?? "");
      try {
        const q = await startQuery(message, {
          model: sdkOpts.model.id,
          cwd: sdkOpts.local.cwd,
          ...permissionOptions(denyDestructive),
          ...(toAgentMcpServers(sdkOpts.mcpServers) ? { mcpServers: toAgentMcpServers(sdkOpts.mcpServers) } : {}),
          ...(sdkOpts.disallowedTools?.length ? { disallowedTools: sdkOpts.disallowedTools } : {}),
        });
        return await collectOneShot(q);
      } finally {
        restore();
      }
    },

    create(o) {
      return makeAgent({
        model: o.model.id,
        cwd: o.local.cwd,
        apiKey: o.apiKey,
        mcpServers: toAgentMcpServers(o.mcpServers),
      });
    },

    resume(agentId, o) {
      // host.ts's resume opts carry no cwd; default to the process cwd. The Agent
      // SDK re-establishes context from `resume`, but tools run in this cwd.
      return makeAgent({
        model: o.model?.id?.trim() || DEFAULT_CLAUDE_AGENT_MODEL,
        cwd: process.cwd(),
        apiKey: o.apiKey,
        mcpServers: toAgentMcpServers(o.mcpServers),
        sessionId: agentId,
      });
    },
  };
}
