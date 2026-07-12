/**
 * homebase (I-159) last-seen state: one JSON file, composite-key entries
 * (`<canonicalRepoPath>::<agentId>`), mirroring gatewayModeStore.ts /
 * gatewayFollowupStore.ts. No git awareness here — callers pass an already
 * canonicalized repo path (see homebase.ts's canonicalRepoPath).
 *
 * Only handoff() (via setLastSeen) writes. Concurrent handoff() from two agent
 * sessions on the same repo is a designed use case, not a rare edge case — an
 * advisory stale-mtime lock (shape borrowed from memoryConsolidate.ts's
 * acquireLock/releaseLock) guards the read-modify-write, spin-waiting briefly
 * rather than dropping a write outright.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { sleep, writeFileAtomic, guardProdStateWrite } from "./util.js";

export const HOMEBASE_LASTSEEN_FILE = "homebase.lastseen.json";

const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 2_000;
const LOCK_POLL_MS = 50;

export interface LastSeenEntry {
  /** Empty string means "no HEAD to checkpoint yet" (zero-commit repo at handoff time). */
  lastSeenSha: string;
  lastVisitAtMs: number;
  openThreads: string[];
  handoffSummary?: string;
  handoffAtMs?: number;
}

export interface HomebaseLastSeenFile {
  version: number;
  entries: Record<string, LastSeenEntry>;
}

function repoKey(canonicalPath: string, agentId: string): string {
  return `${canonicalPath}::${agentId}`;
}

function lastSeenPath(dir: string, stateDir: string): string {
  return resolve(dir, stateDir, HOMEBASE_LASTSEEN_FILE);
}

function lockPath(dir: string, stateDir: string): string {
  return resolve(dir, stateDir, `${HOMEBASE_LASTSEEN_FILE}.lock`);
}

function validEntry(e: unknown): e is LastSeenEntry {
  const x = e as LastSeenEntry;
  return (
    !!x &&
    typeof x.lastSeenSha === "string" &&
    typeof x.lastVisitAtMs === "number" &&
    Array.isArray(x.openThreads)
  );
}

/**
 * Corrupt-JSON fallback backs up the unreadable file and logs loudly before
 * returning empty — unlike gatewayModeStore's silent-empty fallback, because
 * this file holds irreplaceable per-project handoff text for every repo the
 * agent has worked, not ephemeral routing state.
 */
export function loadLastSeen(dir: string, stateDir: string): HomebaseLastSeenFile {
  const p = lastSeenPath(dir, stateDir);
  if (!existsSync(p)) return { version: 1, entries: {} };
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    const raw = parsed?.entries && typeof parsed.entries === "object" ? parsed.entries : {};
    const entries: Record<string, LastSeenEntry> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (validEntry(v)) entries[k] = v;
    }
    return { version: 1, entries };
  } catch (e) {
    try {
      const backup = `${p}.corrupt-${Date.now()}`;
      copyFileSync(p, backup);
      console.error(
        `homebase: ${p} failed to parse, backed up to ${backup}, starting from empty state: ${(e as Error).message}`
      );
    } catch (backupErr) {
      console.error(`homebase: ${p} failed to parse AND backup failed: ${(backupErr as Error).message}`);
    }
    return { version: 1, entries: {} };
  }
}

export function saveLastSeen(dir: string, stateDir: string, data: HomebaseLastSeenFile): void {
  const p = lastSeenPath(dir, stateDir);
  guardProdStateWrite(resolve(p, ".."), HOMEBASE_LASTSEEN_FILE);
  mkdirSync(resolve(p, ".."), { recursive: true });
  writeFileAtomic(p, JSON.stringify(data, null, 2) + "\n");
}

/** True if acquired; false if a fresh lock is already held. Stale locks are reclaimed. */
function acquireLock(dir: string, stateDir: string, now: number): boolean {
  const p = lockPath(dir, stateDir);
  if (existsSync(p)) {
    try {
      if (now - statSync(p).mtimeMs < LOCK_STALE_MS) return false;
    } catch {
      /* unreadable -> treat as stale */
    }
  }
  mkdirSync(resolve(p, ".."), { recursive: true });
  writeFileSync(p, new Date(now).toISOString());
  return true;
}

function releaseLock(dir: string, stateDir: string): void {
  try {
    rmSync(lockPath(dir, stateDir));
  } catch {
    /* already gone */
  }
}

/**
 * Spin-wait up to LOCK_WAIT_MS for the lock; on timeout, proceed anyway with a
 * loud warning rather than silently dropping the write — losing a handoff is
 * worse than the rare residual race after a bounded wait.
 */
async function withLock<T>(dir: string, stateDir: string, fn: () => T): Promise<T> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    if (acquireLock(dir, stateDir, Date.now())) {
      try {
        return fn();
      } finally {
        releaseLock(dir, stateDir);
      }
    }
    if (Date.now() >= deadline) {
      console.error(`homebase: lock busy after ${LOCK_WAIT_MS}ms — proceeding without lock (rare residual race)`);
      return fn();
    }
    await sleep(LOCK_POLL_MS);
  }
}

export async function setLastSeen(
  dir: string,
  stateDir: string,
  canonicalPath: string,
  agentId: string,
  entry: LastSeenEntry
): Promise<void> {
  await withLock(dir, stateDir, () => {
    const file = loadLastSeen(dir, stateDir);
    file.entries[repoKey(canonicalPath, agentId)] = entry;
    saveLastSeen(dir, stateDir, file);
  });
}

export function getLastSeen(
  dir: string,
  stateDir: string,
  canonicalPath: string,
  agentId: string
): LastSeenEntry | undefined {
  return loadLastSeen(dir, stateDir).entries[repoKey(canonicalPath, agentId)];
}
