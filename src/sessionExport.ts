/**
 * Export recent session transcripts to markdown (I-12, roadmap R3-1).
 * Cron builtin `session-export` writes Reports/sessions/YYYY-MM-DD/*.md.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { createStore, type RunRecord, type SessionRecord } from "./store.js";

export interface SessionExportOptions {
  /** Export sessions updated within this window (default 24h). */
  windowHours?: number;
  /** Output root; default `<dir>/Reports/sessions`. */
  outRoot?: string;
  /** Max sessions per export (default 50). */
  limit?: number;
}

export interface SessionExportResult {
  exported: number;
  outDir: string;
  files: string[];
}

function dayStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function safeName(id: string): string {
  return id.replace(/[^\w.-]+/g, "_").slice(0, 40);
}

export function formatSessionRunsMarkdown(session: SessionRecord, runs: RunRecord[]): string {
  const lines: string[] = [
    `# ${session.title || session.id}`,
    "",
    `- **session:** \`${session.id}\``,
    `- **channel:** \`${session.channel || "-"}\``,
    `- **cwd:** \`${session.cwd}\``,
    `- **updated:** ${session.updated_at}`,
    `- **runs:** ${runs.length}`,
    "",
  ];
  for (const r of runs) {
    lines.push(`## ${r.started_at} · ${r.status}`);
    lines.push("");
    if (r.prompt_preview.trim()) lines.push("**User:**", "", r.prompt_preview.trim(), "");
    if (r.result_preview?.trim()) lines.push("**Assistant:**", "", r.result_preview.trim(), "");
    if (r.error_detail?.trim()) lines.push("**Error:**", "", "```", r.error_detail.trim(), "```", "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export async function exportRecentSessions(
  dir: string,
  opts: SessionExportOptions = {}
): Promise<SessionExportResult> {
  const cfg = loadConfig(dir);
  const windowMs = Math.max(1, opts.windowHours ?? 24) * 3600_000;
  const cutoff = Date.now() - windowMs;
  const limit = Math.max(1, opts.limit ?? 50);
  const outRoot = opts.outRoot ?? resolve(dir, "Reports", "sessions");
  const outDir = resolve(outRoot, dayStamp(new Date()));

  const store = createStore(dir, cfg.stateDir);
  const files: string[] = [];
  try {
    const sessions = await store.listSessions(500);
    const recent = sessions
      .filter((s) => {
        const t = Date.parse(s.updated_at);
        return Number.isFinite(t) && t >= cutoff;
      })
      .slice(0, limit);
    for (const s of recent) {
      const runs = await store.listRuns(s.id);
      if (runs.length === 0) continue;
      mkdirSync(outDir, { recursive: true });
      const path = resolve(outDir, `${safeName(s.id)}.md`);
      writeFileSync(path, formatSessionRunsMarkdown(s, runs), { encoding: "utf8", mode: 0o600 });
      files.push(path);
    }
  } finally {
    await store.close();
  }
  return { exported: files.length, outDir, files };
}
