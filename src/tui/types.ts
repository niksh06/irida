export type MessageRole = "user" | "assistant" | "system" | "error";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  streaming?: boolean;
}

export interface SessionMeta {
  sessionId: string;
  agentId: string | null;
  cwd: string;
  model: string;
  connectMode?: string;
}

export type Overlay = null | "help" | "sessions" | "skills" | "memory" | "doctor" | "tools" | "model" | "mcp";

export interface ActivityEntry {
  id: string;
  at: string;
  label: string;
  kind: "tool" | "mcp" | "other";
  toolName?: string;
  command?: string;
  status?: "running" | "completed" | "error";
  phase?: "call" | "result";
  callId?: string;
  detail?: string;
  exitCode?: number;
  durationMs?: number;
  stdoutPreview?: string;
  finishedAt?: string;
}

export interface TurnStats {
  durationMs: number;
  toolCalls: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ConfirmState {
  reason: string;
  resolve: (allowed: boolean) => void;
}
