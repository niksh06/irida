import { slashHelpLines } from "./slashCatalog.js";

export type SlashAction =
  | { type: "exit" }
  | { type: "clear" }
  | { type: "help" }
  | { type: "sessions" }
  | { type: "resume"; sessionId: string }
  | { type: "new" }
  | { type: "skills" }
  | { type: "memory" }
  | { type: "doctor" }
  | { type: "tools" }
  | { type: "model" }
  | { type: "mcp" }
  | { type: "copy" }
  | { type: "export"; path?: string }
  | { type: "rename"; title: string }
  | { type: "unknown"; command: string };

export const SLASH_HELP = slashHelpLines().join("\n");

export function parseSlash(input: string): SlashAction | null {
  const t = input.trim();
  if (!t.startsWith("/")) return null;
  const [cmd, ...rest] = t.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();
  switch (cmd.toLowerCase()) {
    case "exit":
    case "quit":
    case "q":
      return { type: "exit" };
    case "clear":
      return { type: "clear" };
    case "help":
    case "?":
      return { type: "help" };
    case "sessions":
    case "session":
      return { type: "sessions" };
    case "resume":
      if (!arg) return { type: "unknown", command: "/resume requires a session id" };
      return { type: "resume", sessionId: arg };
    case "new":
    case "fresh":
      return { type: "new" };
    case "skills":
    case "skill":
      return { type: "skills" };
    case "memory":
    case "mem":
      return { type: "memory" };
    case "doctor":
      return { type: "doctor" };
    case "tools":
    case "activity":
      return { type: "tools" };
    case "model":
    case "models":
      return { type: "model" };
    case "mcp":
      return { type: "mcp" };
    case "copy":
    case "yank":
      return { type: "copy" };
    case "export":
      return { type: "export", path: arg || undefined };
    case "rename":
      if (!arg) return { type: "unknown", command: "/rename requires a title" };
      return { type: "rename", title: arg };
    default:
      return { type: "unknown", command: cmd };
  }
}
