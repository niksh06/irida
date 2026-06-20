import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { ChatMessage, SessionMeta } from "./types.js";

export class ExportPathError extends Error {}

/** Render chat messages as markdown for handoff / Obsidian. */
export function formatTranscriptMarkdown(
  messages: ChatMessage[],
  meta?: Pick<SessionMeta, "sessionId" | "model" | "cwd">
): string {
  const lines: string[] = ["# irida transcript", ""];
  if (meta) {
    lines.push(`- **session:** \`${meta.sessionId}\``);
    lines.push(`- **model:** \`${meta.model}\``);
    lines.push(`- **cwd:** \`${meta.cwd}\``);
    lines.push(`- **exported:** ${new Date().toISOString()}`);
    lines.push("");
  }

  for (const m of messages) {
    if (m.streaming) continue;
    const body = m.text.trim();
    if (!body) continue;
    switch (m.role) {
      case "user":
        lines.push("## User", "", body, "");
        break;
      case "assistant":
        lines.push("## Assistant", "", body, "");
        break;
      case "error":
        lines.push("## Error", "", body, "");
        break;
      case "system":
        lines.push("> " + body.replace(/\n/g, "\n> "), "");
        break;
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** Default export path under project `.agent/exports/`. */
export function defaultExportPath(cwd: string, sessionId: string): string {
  const safe = sessionId.replace(/[^\w.-]+/g, "_").slice(0, 24);
  return resolve(cwd, ".agent", "exports", `transcript-${safe}-${stamp()}.md`);
}

/** Resolve user path or default; must stay inside cwd. */
export function resolveExportPath(cwd: string, sessionId: string, userPath?: string): string {
  const normCwd = resolve(cwd);
  const target = userPath?.trim()
    ? resolve(normCwd, userPath.replace(/^['"]|['"]$/g, ""))
    : defaultExportPath(normCwd, sessionId);
  const rel = relative(normCwd, target);
  if (rel.startsWith("..") || resolve(target) === resolve("/")) {
    throw new ExportPathError(`export path escapes workspace: ${userPath ?? target}`);
  }
  return target;
}

export function writeTranscriptExport(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}
