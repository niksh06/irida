/**
 * Deferred follow-up store (I-126): one-shot, time-based "I'll come back" tasks.
 * The `defer_followup` MCP tool (a stdio subprocess with the chat context in its
 * env) persists an entry here and ends the turn; the cron-tick polls due entries,
 * runs a fresh isolated agent turn for each (NO live-session resume → no
 * divergence with the gateway's cached peer agent), and pushes the result to
 * Telegram via the outbox.
 *
 * Path resolution mirrors gatewayPendingQuestionStore (`resolve(dir, cfg.stateDir,
 * FILE)`) so the subprocess and the gateway/cron processes share one file.
 *
 * One-shot, NOT recurring (that's cron/`/schedule`). Bounded per chat + globally
 * and to a max deferral horizon; entries that come due long after the fact (e.g.
 * the host was down) are pruned as stale rather than fired late.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { peerKey } from "./gatewayPeers.js";
import { guardProdStateWrite, writeFileAtomic, nowIso, newId } from "./util.js";

export const FOLLOWUPS_FILE = "gateway.followups.json";
/** A misbehaving agent could otherwise schedule unbounded self-resumes. */
export const FOLLOWUPS_GLOBAL_MAX = 50;
export const FOLLOWUPS_PER_CHAT_MAX = 5;
/** Longest a follow-up may be deferred (also the after_minutes ceiling). */
export const FOLLOWUP_MAX_DEFER_MS = 24 * 60 * 60 * 1000;
export const FOLLOWUP_MAX_AFTER_MINUTES = FOLLOWUP_MAX_DEFER_MS / 60_000;
/** Past-due grace: fire if due within this window; older = stale (host was down). */
export const FOLLOWUP_STALE_GRACE_MS = 12 * 60 * 60 * 1000;

export interface DeferredFollowup {
  id: string;
  chatId: string;
  adapter: string;
  /** Self-contained intent — the only context the fired follow-up turn sees. */
  reason: string;
  /** ISO time the follow-up becomes due. */
  dueAt: string;
  createdAt: string;
  /** Claim mark (I-139): ISO time a runner claimed this entry before firing. */
  firing?: string;
}

/** A claim older than this belongs to a crashed runner and may be retaken. */
export const FOLLOWUP_CLAIM_TTL_MS = 15 * 60_000;

/** True when `firing` is a live claim (younger than the TTL) at `now`. */
export function hasFreshClaim(entry: DeferredFollowup, now: Date): boolean {
  if (!entry.firing) return false;
  const at = Date.parse(entry.firing);
  return Number.isFinite(at) && now.getTime() - at < FOLLOWUP_CLAIM_TTL_MS;
}

/**
 * Claim-then-run (I-139): mark the entry BEFORE the minutes-long agent run so
 * an overlapping runner (launchd tick + manual `cron tick`) skips it instead
 * of double-firing. Re-reads the store so the decision is made on current
 * disk state — the race window shrinks from the run's duration to one
 * read→write; a full file lock is overkill since ticks themselves are
 * serialized by the cron-tick lock (I-140).
 */
export function claimFollowup(dir: string, id: string, now: Date = new Date()): boolean {
  const file = loadFollowups(dir);
  const entry = file.followups.find((f) => f.id === id);
  if (!entry) return false;
  if (hasFreshClaim(entry, now)) return false;
  entry.firing = now.toISOString();
  saveFollowups(dir, file);
  return true;
}

export interface FollowupsFile {
  version: number;
  followups: DeferredFollowup[];
}

function followupsPath(dir: string): string {
  const cfg = loadConfig(dir);
  return resolve(dir, cfg.stateDir, FOLLOWUPS_FILE);
}

function validEntry(f: unknown): f is DeferredFollowup {
  const e = f as DeferredFollowup;
  return (
    !!e &&
    typeof e.id === "string" &&
    typeof e.chatId === "string" &&
    typeof e.adapter === "string" &&
    typeof e.reason === "string" &&
    typeof e.dueAt === "string"
  );
}

export function loadFollowups(dir: string): FollowupsFile {
  const path = followupsPath(dir);
  if (!existsSync(path)) return { version: 1, followups: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as FollowupsFile;
    const followups = Array.isArray(parsed.followups) ? parsed.followups.filter(validEntry) : [];
    return { version: 1, followups };
  } catch {
    return { version: 1, followups: [] };
  }
}

export function saveFollowups(dir: string, data: FollowupsFile): void {
  const path = followupsPath(dir);
  guardProdStateWrite(resolve(path, ".."), FOLLOWUPS_FILE);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileAtomic(path, JSON.stringify(data, null, 2) + "\n");
}

export interface AddFollowupResult {
  ok: boolean;
  followup?: DeferredFollowup;
  error?: string;
}

/**
 * Schedule a one-shot follow-up. Rejects an out-of-range delay or a chat that is
 * already at its pending cap (so the agent can't pile up self-resumes); the
 * global cap drops the oldest to stay bounded.
 */
export function addFollowup(
  dir: string,
  input: { chatId: string; adapter: string; reason: string; afterMinutes: number }
): AddFollowupResult {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "reason is empty" };
  const mins = Math.round(input.afterMinutes);
  if (!Number.isFinite(mins) || mins < 1 || mins > FOLLOWUP_MAX_AFTER_MINUTES) {
    return { ok: false, error: `after_minutes must be 1..${FOLLOWUP_MAX_AFTER_MINUTES}` };
  }
  const file = loadFollowups(dir);
  const key = peerKey(input.adapter, input.chatId);
  const forChat = file.followups.filter((f) => peerKey(f.adapter, f.chatId) === key);
  if (forChat.length >= FOLLOWUPS_PER_CHAT_MAX) {
    return { ok: false, error: `too many pending follow-ups for this chat (max ${FOLLOWUPS_PER_CHAT_MAX})` };
  }
  const entry: DeferredFollowup = {
    id: newId("fu"),
    chatId: input.chatId,
    adapter: input.adapter,
    reason,
    dueAt: new Date(Date.now() + mins * 60_000).toISOString(),
    createdAt: nowIso(),
  };
  // Newest-first, then global cap.
  const followups = [entry, ...file.followups].slice(0, FOLLOWUPS_GLOBAL_MAX);
  saveFollowups(dir, { version: 1, followups });
  return { ok: true, followup: entry };
}

export function listFollowups(dir: string, adapter?: string, chatId?: string): DeferredFollowup[] {
  const all = loadFollowups(dir).followups;
  if (!adapter || !chatId) return all;
  const key = peerKey(adapter, chatId);
  return all.filter((f) => peerKey(f.adapter, f.chatId) === key);
}

export function getFollowup(dir: string, id: string): DeferredFollowup | undefined {
  return loadFollowups(dir).followups.find((f) => f.id === id);
}

/** Drop a follow-up by id. Returns true if one was removed. */
export function clearFollowup(dir: string, id: string): boolean {
  const file = loadFollowups(dir);
  const followups = file.followups.filter((f) => f.id !== id);
  if (followups.length === file.followups.length) return false;
  saveFollowups(dir, { version: 1, followups });
  return true;
}

/**
 * Split currently-due follow-ups into `due` (fire now) and `stale` (came due
 * more than the grace window ago — prune without firing, the host was likely
 * down). Not-yet-due entries are left untouched.
 */
export function dueFollowups(
  dir: string,
  now: Date = new Date()
): { due: DeferredFollowup[]; stale: DeferredFollowup[] } {
  const t = now.getTime();
  const due: DeferredFollowup[] = [];
  const stale: DeferredFollowup[] = [];
  for (const f of loadFollowups(dir).followups) {
    const dueMs = Date.parse(f.dueAt);
    if (!Number.isFinite(dueMs) || dueMs > t) continue; // not due yet (or unparseable → leave)
    if (t - dueMs > FOLLOWUP_STALE_GRACE_MS) stale.push(f);
    else due.push(f);
  }
  // Fire oldest-due first.
  due.sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  return { due, stale };
}
