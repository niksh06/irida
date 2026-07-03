/**
 * Ordered, tracked schema migrations (I-141 / audit H-13).
 *
 * Modules used to lazily apply their own hardcoded .sql subsets on first use —
 * no global ordering, no record of what ran, and a duplicated "006" filename
 * slipped in unnoticed. This runner applies deploy/postgres/migrations/*.sql
 * in filename order exactly once per database (tracked in schema_migrations),
 * each file in its own transaction. All shipped migrations are idempotent
 * (IF NOT EXISTS style), so the first tracked pass over a pre-runner database
 * replays them as no-ops and simply records them.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../deploy/postgres/migrations"
);

/**
 * Feature-gated migrations: applied only when the database can support them.
 * 008 needs the pgvector extension — plain PostgreSQL installs (no embedder
 * configured) must not fail the whole schema pass over an optional feature.
 */
const OPTIONAL_BY_EXTENSION: Record<string, string> = {
  "008_memory_vector.sql": "vector",
};

/** One schema pass per database per process — concurrent callers share it. */
const inflight = new Map<string, Promise<void>>();

/**
 * Cross-PROCESS serialization (H-7 finding): two runners on a fresh database
 * (gateway + cron tick, or parallel test files) race CREATE EXTENSION /
 * CREATE TABLE / the schema_migrations insert itself into duplicate-key
 * errors. A session-level advisory lock lets the first pass win; waiters
 * re-read schema_migrations after acquiring and no-op.
 */
const MIGRATIONS_ADVISORY_LOCK = 7_712_001;

export async function runPgMigrations(pool: pg.Pool, key: string): Promise<void> {
  let p = inflight.get(key);
  if (!p) {
    p = apply(pool);
    inflight.set(key, p);
    // A failed pass must not poison the process — retry on the next call.
    p.catch(() => inflight.delete(key));
  }
  return p;
}

/** Test-only: forget memoized passes so a fresh run can be observed. */
export function resetPgMigrationsMemoForTest(): void {
  inflight.clear();
}

export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

async function extensionAvailable(pool: pg.Pool, name: string): Promise<boolean> {
  const res = await pool.query("SELECT 1 FROM pg_available_extensions WHERE name = $1", [name]);
  return (res.rowCount ?? 0) > 0;
}

async function apply(pool: pg.Pool): Promise<void> {
  // The advisory lock is session-scoped: hold ONE client for the whole pass
  // and run every statement on it, so a concurrent runner blocks on acquire
  // and then sees the winner's schema_migrations rows.
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATIONS_ADVISORY_LOCK]);
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           filename text PRIMARY KEY,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`
      );
      const done = new Set<string>(
        (await client.query("SELECT filename FROM schema_migrations")).rows.map(
          (r: { filename: string }) => r.filename
        )
      );
      for (const file of listMigrationFiles()) {
        if (done.has(file)) continue;
        const requiredExt = OPTIONAL_BY_EXTENSION[file];
        if (requiredExt && !(await extensionAvailable(pool, requiredExt))) {
          console.error(
            `[pg] migration ${file} skipped — extension "${requiredExt}" not available (optional feature; retried next start)`
          );
          continue;
        }
        const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
        try {
          await client.query("BEGIN");
          await client.query(sql);
          await client.query("INSERT INTO schema_migrations(filename) VALUES ($1)", [file]);
          await client.query("COMMIT");
          console.error(`[pg] migration applied: ${file}`);
        } catch (e) {
          await client.query("ROLLBACK").catch(() => {});
          throw new Error(`migration ${file} failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATIONS_ADVISORY_LOCK]).catch(() => {});
    }
  } finally {
    client.release();
  }
}
