/**
 * Claude Agent SDK engine adapter (Irida / I-100).
 *
 * Wraps `@anthropic-ai/claude-agent-sdk` behind the same `SdkLike` interface the
 * Cursor SDK satisfies, so `run`/cron share one execution path. The Agent SDK is
 * a full agent runtime (its own loop, tools, MCP) — selecting it is the second
 * engine, not a completion fallback.
 *
 * Auth (two modes, per engine.auth):
 *  - "api-key": Anthropic API key via env ANTHROPIC_API_KEY.
 *  - "account": Claude subscription via env CLAUDE_CODE_OAUTH_TOKEN (from
 *    `claude setup-token`), or — when no token is supplied — an existing
 *    `claude login` session the bundled binary reads from ~/.claude/.credentials.json.
 * The two credentials must not both be set for one call: API key would override
 * account auth. `applyEngineAuthEnv` sets one and clears the other for the call.
 *
 * MVP scope: one-shot `prompt()` (SdkLike). Interactive create/resume come later.
 */
import type { SdkLike, SdkPromptResult, McpServers } from "../host.js";
import type { EngineAuth } from "../config.js";

function restoreEnv(name: string, prev: string | undefined): void {
  if (prev === undefined) delete process.env[name];
  else process.env[name] = prev;
}

/**
 * Point the Agent SDK at exactly one credential for the duration of a call, then
 * restore. `secret` may be empty in account mode → rely on the `claude login`
 * session in ~/.claude. Returns a restore thunk; always call it in `finally`.
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

/** Map csagent MCP entries ({command}|{url}) to Agent SDK McpServerConfig. */
function toAgentMcpServers(mcp?: McpServers): Record<string, unknown> | undefined {
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
      out[name] = {
        type: "http",
        url: o.url,
        ...(o.headers && typeof o.headers === "object" ? { headers: o.headers } : {}),
      };
    }
    // Entries that match neither shape are dropped (logged by the caller's MCP validation).
  }
  return Object.keys(out).length ? out : undefined;
}

export function createClaudeAgentSdk(opts?: { authMode?: EngineAuth }): SdkLike {
  const authMode: EngineAuth = opts?.authMode ?? "api-key";
  return {
    async prompt(message, sdkOpts): Promise<SdkPromptResult> {
      const restore = applyEngineAuthEnv(authMode, sdkOpts.apiKey ?? "");
      try {
        const { query } = await import("@anthropic-ai/claude-agent-sdk");
        const mcpServers = toAgentMcpServers(sdkOpts.mcpServers);
        const q = query({
          prompt: message,
          options: {
            model: sdkOpts.model.id,
            cwd: sdkOpts.local.cwd,
            // Non-interactive run: the model's tool calls must not block on prompts.
            // Parity with the Cursor `run` path, which is also non-interactive and
            // relies on the prompt-level safetyGate upstream.
            permissionMode: "bypassPermissions",
            ...(mcpServers ? { mcpServers } : {}),
          },
        } as Parameters<typeof query>[0]);

        let resultText = "";
        let sessionId: string | undefined;
        let isError = false;
        for await (const m of q as AsyncIterable<Record<string, unknown>>) {
          if (m?.type === "result") {
            sessionId = typeof m.session_id === "string" ? m.session_id : sessionId;
            isError = Boolean(m.is_error);
            if (typeof m.result === "string") resultText = m.result;
          }
        }
        return {
          status: isError ? "error" : "finished",
          result: resultText,
          id: sessionId,
          agentId: sessionId,
        };
      } finally {
        restore();
      }
    },
  };
}
