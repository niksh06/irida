export interface SlashCommandDef {
  cmd: string;
  desc: string;
  args?: string;
}

export const SLASH_COMMANDS: SlashCommandDef[] = [
  { cmd: "help", desc: "Show commands and hotkeys" },
  { cmd: "clear", desc: "Clear transcript" },
  { cmd: "sessions", desc: "Pick a stored session" },
  { cmd: "resume", desc: "Switch session by id", args: "<id>" },
  { cmd: "new", desc: "Start a fresh chat session" },
  { cmd: "skills", desc: "List local skills" },
  { cmd: "doctor", desc: "Environment checks" },
  { cmd: "tools", desc: "Tool / MCP activity log" },
  { cmd: "model", desc: "Pick SDK model" },
  { cmd: "mcp", desc: "Show MCP server config" },
  { cmd: "copy", desc: "Copy last reply (OSC52)" },
  { cmd: "exit", desc: "Quit TUI" },
];

/** Lines for /help panel (derived from catalog). */
export function slashHelpLines(): string[] {
  const rows = SLASH_COMMANDS.map((c) => {
    const usage = c.args ? `/${c.cmd} ${c.args}` : `/${c.cmd}`;
    return `${usage.padEnd(18)} — ${c.desc}`;
  });
  return [...rows, "", "trackpad scroll · Ctrl+O keyboard scroll · Ctrl+G/E · Ctrl+J newline · @file:path"];
}

/** Match slash command prefixes for autocomplete (first token only). */
export function filterSlashSuggestions(input: string): string[] {
  const t = input.trimStart();
  if (!t.startsWith("/")) return [];
  const body = t.slice(1);
  if (body.includes(" ")) return [];
  const partial = body.toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(partial)).map((c) =>
    c.args ? `/${c.cmd} ` : `/${c.cmd}`
  );
}

/** Longest shared prefix among suggestions (for partial Tab). */
export function commonSlashPrefix(suggestions: string[]): string {
  if (suggestions.length === 0) return "";
  if (suggestions.length === 1) return suggestions[0]!;
  let prefix = suggestions[0]!;
  for (const s of suggestions.slice(1)) {
    while (!s.startsWith(prefix) && prefix.length > 1) {
      prefix = prefix.slice(0, -1);
    }
  }
  return prefix;
}
