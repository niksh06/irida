/**
 * Ref-counted shared SQLite handle for session + memory stores (R2-6).
 * Both open state.sqlite with separate handles today; WAL masks SQLITE_BUSY.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const pools = new Map<string, { db: DatabaseSync; refs: number }>();

export function sqliteStateDbPath(stateRoot: string): string {
  return resolve(stateRoot, "state.sqlite");
}

export function acquireSharedSqliteDb(stateRoot: string): DatabaseSync {
  const root = resolve(stateRoot);
  mkdirSync(root, { recursive: true });
  const path = sqliteStateDbPath(root);
  let entry = pools.get(path);
  if (!entry) {
    const db = new DatabaseSync(path);
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;`);
    entry = { db, refs: 0 };
    pools.set(path, entry);
  }
  entry.refs += 1;
  return entry.db;
}

export function releaseSharedSqliteDb(stateRoot: string): void {
  const path = sqliteStateDbPath(resolve(stateRoot));
  const entry = pools.get(path);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs === 0) {
    pools.delete(path);
    try {
      entry.db.close();
    } catch {
      /* already closed */
    }
  }
}

/** Test hook — drop all pooled handles. */
export function resetSharedSqlitePoolsForTests(): void {
  for (const entry of pools.values()) {
    try {
      entry.db.close();
    } catch {
      /* ignore */
    }
  }
  pools.clear();
}
