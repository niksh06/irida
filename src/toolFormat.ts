/**
 * Format Cursor SDK tool/stream events for TUI activity display.
 * Handles SDKMessage tool_call, assistant tool_use blocks, and conversation toolCall shapes.
 */

export interface ToolActivity {
  label: string;
  kind: "tool" | "mcp" | "other";
  toolName: string;
  /** Full command / action description (not truncated). */
  command: string;
  status?: "running" | "completed" | "error";
  phase: "call" | "result";
  callId?: string;
  detail?: string;
  exitCode?: number;
  durationMs?: number;
  stdoutPreview?: string;
}

export type ActivityDetail = ToolActivity;

export interface ParsedToolResult {
  exitCode?: number;
  durationMs?: number;
  stdoutPreview?: string;
  detail?: string;
}

export function parseToolResult(result: unknown): ParsedToolResult {
  if (result == null) return {};
  if (typeof result === "string") {
    const t = result.trim();
    return t ? { stdoutPreview: t.slice(0, 160), detail: t.slice(0, 200) } : {};
  }
  if (!isRecord(result)) return {};

  let exitCode: number | undefined;
  let durationMs: number | undefined;
  let stdoutPreview: string | undefined;

  if (typeof result.duration_ms === "number") durationMs = result.duration_ms;
  if (typeof result.durationMs === "number") durationMs = result.durationMs;

  const value = isRecord(result.value) ? (result.value as Record<string, unknown>) : result;
  if (typeof value.exitCode === "number") exitCode = value.exitCode;
  if (typeof value.exit_code === "number") exitCode = value.exit_code;
  if (typeof value.duration_ms === "number") durationMs = value.duration_ms;
  if (typeof value.durationMs === "number") durationMs = value.durationMs;
  if (typeof value.stdout === "string" && value.stdout.trim()) {
    stdoutPreview = value.stdout.trim().slice(0, 160);
  }
  if (!stdoutPreview && typeof value.output === "string" && value.output.trim()) {
    stdoutPreview = value.output.trim().slice(0, 160);
  }
  if (exitCode === undefined && (result.status === "error" || value.success === false)) {
    exitCode = typeof value.exitCode === "number" ? value.exitCode : 1;
  }

  const detail = formatResultDetail({ exitCode, durationMs, stdoutPreview });
  return { exitCode, durationMs, stdoutPreview, detail: detail || undefined };
}

export function formatResultDetail(r: {
  exitCode?: number;
  durationMs?: number;
  stdoutPreview?: string;
}): string {
  const parts: string[] = [];
  if (r.exitCode !== undefined) parts.push(`exit ${r.exitCode}`);
  if (r.durationMs !== undefined) parts.push(formatDuration(r.durationMs));
  if (r.stdoutPreview) parts.push(`stdout: ${r.stdoutPreview}`);
  return parts.join(" · ");
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

export function parseToolStreamEvent(ev: unknown): ToolActivity | null {
  if (ev == null || typeof ev !== "object") return null;
  const e = ev as Record<string, unknown>;

  if (e.type === "tool_call") {
    return fromSdkToolCall(e);
  }

  if (e.type === "assistant" && isRecord(e.message)) {
    const fromAssistant = fromAssistantContent(e.message as { content?: unknown });
    if (fromAssistant) return fromAssistant;
  }

  if (e.type === "toolCall" && isRecord(e.message)) {
    return fromConversationToolCall(e.message as Record<string, unknown>);
  }

  if (e.type === "sdk_message" && isRecord(e.message)) {
    return parseToolStreamEvent(e.message);
  }

  return fromLegacyShape(e);
}

function fromSdkToolCall(e: Record<string, unknown>): ToolActivity | null {
  const name = String(e.name ?? "tool");
  const status = normalizeStatus(e.status);
  const args = e.args ?? e.input;
  const command = formatToolInvocation(name, args);
  const phase: "call" | "result" = status === "running" ? "call" : "result";
  const callId = typeof e.call_id === "string" ? e.call_id : undefined;
  const parsed = phase === "result" ? parseToolResult(e.result) : {};
  return {
    label: phase === "call" ? `${name}` : `${name} ✓`,
    kind: isMcpTool(name) ? "mcp" : "tool",
    toolName: name,
    command,
    status,
    phase,
    callId,
    detail: parsed.detail ?? (phase === "result" ? summarizeResult(e.result) : undefined),
    exitCode: parsed.exitCode,
    durationMs: parsed.durationMs,
    stdoutPreview: parsed.stdoutPreview,
  };
}

function fromAssistantContent(message: { content?: unknown }): ToolActivity | null {
  if (!Array.isArray(message.content)) return null;
  for (const block of message.content) {
    if (!isRecord(block) || block.type !== "tool_use") continue;
    const name = String(block.name ?? "tool");
    const command = formatToolInvocation(name, block.input);
    return {
      label: name,
      kind: isMcpTool(name) ? "mcp" : "tool",
      toolName: name,
      command,
      status: "running",
      phase: "call",
    };
  }
  return null;
}

function fromConversationToolCall(message: Record<string, unknown>): ToolActivity | null {
  const toolType = String(message.type ?? "");
  const args = isRecord(message.args) ? message.args : {};
  const command = formatConversationTool(toolType, args);
  const toolName = toolType || "tool";
  return {
    label: toolName,
    kind: "tool",
    toolName,
    command,
    status: "running",
    phase: "call",
  };
}

function fromLegacyShape(e: Record<string, unknown>): ToolActivity | null {
  const t = String(e.type ?? "");
  const name = String(e.name ?? e.tool ?? e.toolName ?? "");
  if (!t.includes("tool") && !name) return null;

  const server = String(e.server ?? e.mcpServer ?? "");
  const args = e.input ?? e.args;
  const command = name ? formatToolInvocation(name, args) : t;
  const isCall = t.includes("call") || t === "tool_use";

  return {
    label: name ? `${isCall ? "" : "result: "}${name}`.trim() : t,
    kind: server || isMcpTool(name) ? "mcp" : "tool",
    toolName: name || t,
    command,
    phase: isCall ? "call" : "result",
    detail: server ? `mcp:${server}` : undefined,
  };
}

export function formatToolInvocation(toolName: string, args: unknown): string {
  if (args == null) return toolName;
  if (typeof args === "string") return args.trim() || toolName;

  if (!isRecord(args)) {
    try {
      return JSON.stringify(args, null, 0);
    } catch {
      return toolName;
    }
  }

  const lower = toolName.toLowerCase();
  if (typeof args.command === "string") {
    return args.command;
  }
  if (typeof args.pattern === "string") {
    const path = args.path ?? args.globPattern ?? args.targetDirectory ?? ".";
    return `grep ${JSON.stringify(args.pattern)} ${path}`;
  }
  if (lower.includes("shell") || lower.includes("bash") || lower.includes("terminal")) {
    return String(args.command ?? args.cmd ?? JSON.stringify(args));
  }
  if (typeof args.globPattern === "string") {
    const dir = args.targetDirectory ? ` in ${args.targetDirectory}` : "";
    return `glob ${args.globPattern}${dir}`;
  }
  if (typeof args.path === "string" && typeof args.fileText === "string") {
    const n = args.fileText.length;
    return `write ${args.path} (${n} chars)`;
  }
  if (typeof args.path === "string" && typeof args.offset === "number") {
    return `read ${args.path} offset=${args.offset}`;
  }
  if (typeof args.path === "string" && lower === "read") {
    return `read ${args.path}`;
  }
  if (typeof args.path === "string") {
    return `${toolName} ${args.path}`;
  }
  if (typeof args.query === "string") {
    return `search ${JSON.stringify(args.query)}`;
  }

  return formatConversationTool(toolName, args);
}

function formatConversationTool(toolType: string, args: Record<string, unknown>): string {
  switch (toolType) {
    case "shell":
      return String(args.command ?? "");
    case "write":
      return `write ${args.path ?? "?"} (${String(args.fileText ?? "").length} chars)`;
    case "read":
      return `read ${args.path ?? "?"}`;
    case "delete":
      return `delete ${args.path ?? "?"}`;
    case "glob":
      return `glob ${args.globPattern ?? "?"}${args.targetDirectory ? ` in ${args.targetDirectory}` : ""}`;
    case "grep":
      return `grep ${JSON.stringify(args.pattern ?? "")} ${args.path ?? args.targetDirectory ?? "."}`;
    default:
      if (typeof args.command === "string") return args.command;
      try {
        const compact = JSON.stringify(args);
        return toolType ? `${toolType} ${compact}` : compact;
      } catch {
        return toolType || "tool";
      }
  }
}

function summarizeResult(result: unknown): string | undefined {
  const parsed = parseToolResult(result);
  return parsed.detail;
}

function normalizeStatus(s: unknown): "running" | "completed" | "error" | undefined {
  if (s === "running" || s === "completed" || s === "error") return s;
  return undefined;
}

function isMcpTool(name: string): boolean {
  return name.includes("mcp") || name.startsWith("MCP");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** @deprecated use parseToolStreamEvent */
export function eventActivityDetail(ev: unknown): ActivityDetail | null {
  return parseToolStreamEvent(ev);
}

export function eventActivity(ev: unknown): string | null {
  const a = parseToolStreamEvent(ev);
  return a ? a.command : null;
}
