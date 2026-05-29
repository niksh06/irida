export type SlashAction =
  | { type: "exit" }
  | { type: "clear" }
  | { type: "help" }
  | { type: "sessions" }
  | { type: "resume"; sessionId: string }
  | { type: "unknown"; command: string };

export const SLASH_HELP = [
  "/help       — this panel",
  "/clear      — clear transcript",
  "/sessions   — pick a stored session",
  "/resume <id>— switch to session by id",
  "/exit       — quit (also exit, quit, :q)",
  "",
  "Scroll: Ctrl+U up · Ctrl+D down · Ctrl+E follow latest",
].join("\n");

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
    default:
      return { type: "unknown", command: cmd };
  }
}
