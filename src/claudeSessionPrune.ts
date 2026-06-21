/**
 * Prune stale Claude Agent SDK session transcripts (I-? digest follow-up).
 *
 * The Agent SDK writes one JSONL transcript per session under
 * `~/.claude/projects/<cwd-hash>/<session_id>.jsonl`. One-shot runs (cron digest,
 * delegates) create a transcript that is never resumed, so they accumulate
 * ("orphan sessions"). This prunes them by AGE: only transcripts untouched for
 * more than `maxAgeDays` are removed, so an active resumable session — the
 * gateway's, appended to on every turn — keeps a fresh mtime and survives, while
 * one-shot orphans age out. Safe no-op when `~/.claude/projects` is absent.
 */
import { readdirSync, statSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Recursively collect `*.jsonl` paths under `dir` (session transcripts +
 * nested `subagents/agent-*.jsonl`). Tolerant of unreadable subdirs. */
function collectJsonl(dir: string, out: string[]): void {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) collectJsonl(p, out);
    else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
  }
}

export interface ClaudeSessionPruneResult {
  scanned: number;
  pruned: number;
  bytesFreed: number;
  maxAgeDays: number;
}

export const DEFAULT_CLAUDE_SESSION_MAX_AGE_DAYS = 14;

export function pruneClaudeSessions(
  opts: { maxAgeDays?: number; root?: string; now?: number; dryRun?: boolean } = {}
): ClaudeSessionPruneResult {
  const maxAgeDays = opts.maxAgeDays ?? DEFAULT_CLAUDE_SESSION_MAX_AGE_DAYS;
  const root = opts.root ?? join(homedir(), ".claude", "projects");
  const now = opts.now ?? Date.now();
  const cutoff = now - maxAgeDays * 86_400_000;
  const result: ClaudeSessionPruneResult = { scanned: 0, pruned: 0, bytesFreed: 0, maxAgeDays };
  if (!existsSync(root)) return result;

  const files: string[] = [];
  collectJsonl(root, files);
  for (const p of files) {
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    result.scanned++;
    if (st.mtimeMs < cutoff) {
      result.bytesFreed += st.size;
      if (opts.dryRun) {
        result.pruned++;
      } else {
        try {
          rmSync(p);
          result.pruned++;
        } catch {
          /* leave count untouched on failure */
        }
      }
    }
  }
  return result;
}

/** Human-readable byte size for log lines. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}
