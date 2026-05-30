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

export type Overlay = null | "help" | "sessions" | "skills" | "doctor" | "tools";

export interface ActivityEntry {
  id: string;
  at: string;
  label: string;
}

export interface ConfirmState {
  reason: string;
  resolve: (allowed: boolean) => void;
}
