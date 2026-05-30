/**
 * AgentHost (one-shot slice): thin wrapper over the Cursor SDK so commands and
 * tests share one execution path. The SDK dependency is injectable so tests run
 * without network or a real API key.
 *
 * Failure model (ADR-0001):
 *   - thrown error      -> StartupError (auth/config/network; nothing executed)
 *   - status === error  -> executed run that failed mid-flight
 *   - status finished   -> success
 */
export interface SdkPromptResult {
  status: string;
  result?: string;
  id?: string;
  agentId?: string;
}

export type McpServers = Record<string, unknown>;

export interface SdkLike {
  prompt(
    message: string,
    opts: {
      apiKey: string;
      model: { id: string };
      local: { cwd: string };
      mcpServers?: McpServers;
    }
  ): Promise<SdkPromptResult>;
}

export interface OneShotResult {
  status: string;
  text: string;
  runId: string | null;
  agentId: string | null;
}

export class StartupError extends Error {}

// ── Interactive session shapes (issue 009) ───────────────────────────────
export interface RunLike {
  stream?(): AsyncIterable<unknown>;
  wait(): Promise<{ status: string; id?: string }>;
}

export interface AgentLike {
  agentId?: string;
  send(message: string): Promise<RunLike> | RunLike;
  close?(): Promise<void> | void;
  [Symbol.asyncDispose]?(): Promise<void>;
}

export interface SdkCreateLike {
  create(opts: {
    apiKey: string;
    model: { id: string };
    local: { cwd: string };
    mcpServers?: McpServers;
  }): Promise<AgentLike> | AgentLike;
}

/** Extract assistant text from a streamed SDK event (best-effort, shape-tolerant). */
export function eventText(ev: unknown): string {
  const e = ev as { type?: string; message?: { content?: unknown }; text?: string };
  if (e?.type === "assistant" && Array.isArray(e.message?.content)) {
    return (e.message.content as Array<{ type?: string; text?: string }>)
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");
  }
  if (e?.type === "text" && typeof e.text === "string") return e.text;
  return "";
}

export interface ActivityDetail {
  label: string;
  kind: "tool" | "mcp" | "other";
  detail?: string;
}

/** Best-effort label for tool / activity stream events. */
export function eventActivity(ev: unknown): string | null {
  return eventActivityDetail(ev)?.label ?? null;
}

export function eventActivityDetail(ev: unknown): ActivityDetail | null {
  const e = ev as {
    type?: string;
    name?: string;
    tool?: string;
    toolName?: string;
    server?: string;
    mcpServer?: string;
    input?: unknown;
    message?: { toolName?: string; name?: string; server?: string };
  };
  const t = e?.type ?? "";
  const name = e.name ?? e.tool ?? e.toolName ?? e.message?.toolName ?? e.message?.name;
  const server = e.server ?? e.mcpServer ?? e.message?.server;

  if (t === "tool_call" || t === "tool_use") {
    const label = name ? `call: ${name}` : "tool call";
    const detail = server ? `mcp:${server}` : summarizeInput(e.input);
    return { label, kind: server ? "mcp" : "tool", detail };
  }
  if (t === "tool_result" || t === "tool") {
    const label = name ? `result: ${name}` : "tool result";
    return { label, kind: server ? "mcp" : "tool", detail: server ? `mcp:${server}` : undefined };
  }
  if (t.includes("tool")) {
    return { label: name ? `${t}: ${name}` : t, kind: "tool" };
  }
  if (t.includes("mcp") || server) {
    return { label: name ?? t, kind: "mcp", detail: server ?? undefined };
  }
  return null;
}

function summarizeInput(input: unknown): string | undefined {
  if (input == null) return undefined;
  if (typeof input === "string") return input.slice(0, 80);
  try {
    return JSON.stringify(input).slice(0, 80);
  } catch {
    return undefined;
  }
}

export async function createSession(
  sdk: SdkCreateLike,
  args: { apiKey: string; model: string; cwd: string; mcpServers?: McpServers }
): Promise<AgentLike> {
  try {
    return await sdk.create({
      apiKey: args.apiKey,
      model: { id: args.model },
      local: { cwd: args.cwd },
      ...(args.mcpServers && Object.keys(args.mcpServers).length ? { mcpServers: args.mcpServers } : {}),
    });
  } catch (e) {
    throw new StartupError((e as Error)?.message ?? String(e));
  }
}

export interface SdkResumeLike {
  resume(
    agentId: string,
    opts: { apiKey: string; mcpServers?: McpServers }
  ): Promise<AgentLike> | AgentLike;
}

export async function resumeSession(
  sdk: SdkResumeLike,
  agentId: string,
  apiKey: string,
  mcpServers?: McpServers
): Promise<AgentLike> {
  try {
    return await sdk.resume(agentId, {
      apiKey,
      ...(mcpServers && Object.keys(mcpServers).length ? { mcpServers } : {}),
    });
  } catch (e) {
    throw new StartupError((e as Error)?.message ?? String(e));
  }
}

export async function disposeAgent(agent: AgentLike): Promise<void> {
  try {
    if (typeof agent[Symbol.asyncDispose] === "function") {
      await agent[Symbol.asyncDispose]!();
    } else if (typeof agent.close === "function") {
      await agent.close();
    }
  } catch {
    // disposal best-effort
  }
}

export async function runOneShot(
  sdk: SdkLike,
  args: { prompt: string; apiKey: string; model: string; cwd: string; mcpServers?: McpServers }
): Promise<OneShotResult> {
  let res: SdkPromptResult;
  try {
    res = await sdk.prompt(args.prompt, {
      apiKey: args.apiKey,
      model: { id: args.model },
      local: { cwd: args.cwd },
      ...(args.mcpServers && Object.keys(args.mcpServers).length ? { mcpServers: args.mcpServers } : {}),
    });
  } catch (e) {
    throw new StartupError((e as Error)?.message ?? String(e));
  }
  return {
    status: String(res.status),
    text: String(res.result ?? ""),
    runId: res.id ?? null,
    agentId: res.agentId ?? null,
  };
}
