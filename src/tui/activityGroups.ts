import type { ActivityEntry } from "./types.js";
import { formatDuration } from "../toolFormat.js";

export interface ActivityGroup {
  id: string;
  toolName: string;
  kind: ActivityEntry["kind"];
  entries: ActivityEntry[];
  count: number;
  running: number;
  errors: number;
  lastCommand?: string;
  lastExitCode?: number;
  totalDurationMs?: number;
  lastStdout?: string;
}

/** Tool/MCP entries only — excludes thinking placeholders. */
export function toolActivityEntries(entries: ActivityEntry[]): ActivityEntry[] {
  return entries.filter((e) => e.kind === "tool" || e.kind === "mcp");
}

/** Collapse consecutive same-tool calls into groups. */
export function groupActivityEntries(entries: ActivityEntry[]): ActivityGroup[] {
  const tools = toolActivityEntries(entries);
  const groups: ActivityGroup[] = [];

  for (const e of tools) {
    const name = e.toolName ?? e.label;
    const last = groups[groups.length - 1];
    if (last && last.toolName === name && last.kind === e.kind) {
      last.entries.push(e);
      last.count++;
      refreshGroupStats(last);
    } else {
      const g: ActivityGroup = {
        id: e.id,
        toolName: name,
        kind: e.kind,
        entries: [e],
        count: 1,
        running: 0,
        errors: 0,
      };
      refreshGroupStats(g);
      groups.push(g);
    }
  }
  return groups;
}

function refreshGroupStats(g: ActivityGroup): void {
  g.running = g.entries.filter((e) => e.status === "running").length;
  g.errors = g.entries.filter((e) => e.status === "error").length;
  const last = g.entries[g.entries.length - 1]!;
  g.lastCommand = last.command;
  g.lastExitCode = last.exitCode;
  g.lastStdout = last.stdoutPreview;
  const durations = g.entries.map((e) => e.durationMs).filter((d): d is number => d != null);
  g.totalDurationMs = durations.length ? durations.reduce((a, b) => a + b, 0) : undefined;
}

export function formatGroupSummary(g: ActivityGroup): string {
  const parts: string[] = [g.count > 1 ? `${g.toolName} ×${g.count}` : g.toolName];
  if (g.running > 0) {
    parts.push(`${g.running} running`);
  } else {
    if (g.errors > 0) parts.push(`${g.errors} failed`);
    else if (g.lastExitCode !== undefined) parts.push(`exit ${g.lastExitCode}`);
    if (g.count === 1) {
      const d = g.entries[g.entries.length - 1]?.durationMs;
      if (d != null) parts.push(formatDuration(d));
    } else if (g.totalDurationMs != null) {
      parts.push(formatDuration(g.totalDurationMs));
    }
  }
  return parts.join(" · ");
}

export function activityBarSummary(entries: ActivityEntry[], busy: boolean): string {
  const groups = groupActivityEntries(entries);
  if (groups.length === 0) return busy ? "thinking…" : "";

  const lastG = groups[groups.length - 1]!;
  if (busy && lastG.running > 0) {
    return `${formatGroupSummary(lastG)}…`;
  }

  if (groups.length === 1) return formatGroupSummary(lastG);

  const total = toolActivityEntries(entries).length;
  const typeSummary = groups
    .slice(-3)
    .map((g) => (g.count > 1 ? `${g.toolName}×${g.count}` : g.toolName))
    .join(" · ");
  return `${total} calls · ${typeSummary}`;
}

export function activityCounterLabel(entries: ActivityEntry[]): string | null {
  const tools = toolActivityEntries(entries);
  if (tools.length <= 1) return null;
  const groups = groupActivityEntries(entries);
  if (groups.length <= 1 && tools.length > 1) {
    return `${tools.length} tool events · /tools`;
  }
  if (groups.length > 1) {
    return `${tools.length} calls in ${groups.length} groups · /tools`;
  }
  return null;
}
