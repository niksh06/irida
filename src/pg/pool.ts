/**
 * Shared Postgres pool infrastructure (Arch-1).
 *
 * Before this module, every PG-backed module (sessions/runs store, credentials,
 * gateway allowlist, memory) rolled its own connection string + pool + lifecycle.
 * Those diverging copies were behind multiple prod postmortems (allowlist
 * split-brain, PG-down). This is the single source of truth for:
 *   - resolving CSAGENT_DATABASE_URL
 *   - a ref-counted pool shared per connection string (one user closing must not
 *     end a pool another user still holds)
 *   - a lightweight reachability probe
 *
 * Migration tracking stays in each module — the migration *sets* legitimately
 * differ per domain — but they all draw their pool from here.
 */
import pg from "pg";
import { redact } from "../redact.js";
import { dualEnv } from "../env.js";

/** Default pool size. All PG modules talk to the same small local DB. */
export const DEFAULT_PG_MAX = 5;

/**
 * The configured Postgres connection string (trimmed), or undefined when unset
 * — i.e. sqlite mode. Single read point for CSAGENT_DATABASE_URL (Arch-4).
 */
export function pgUrl(): string | undefined {
  return dualEnv("DATABASE_URL"); // IRIDA_DATABASE_URL, legacy CSAGENT_DATABASE_URL
}

/** True when a Postgres connection string is configured. */
export function pgConfigured(): boolean {
  return pgUrl() !== undefined;
}

/** Resolve the configured connection string; throws if unset. */
export function pgConnectionString(): string {
  const url = pgUrl();
  if (!url) throw new Error("CSAGENT_DATABASE_URL is not set");
  return url;
}

const registry = new Map<string, { pool: pg.Pool; refs: number }>();

/** Acquire a ref-counted pool for a connection string (first caller sets max). */
export function acquirePgPool(connectionString: string, max = DEFAULT_PG_MAX): pg.Pool {
  let entry = registry.get(connectionString);
  if (!entry) {
    entry = { pool: new pg.Pool({ connectionString, max }), refs: 0 };
    registry.set(connectionString, entry);
  }
  entry.refs += 1;
  return entry.pool;
}

/** Release a pool; ends the underlying pool only when the last holder releases. */
export async function releasePgPool(connectionString: string): Promise<void> {
  const entry = registry.get(connectionString);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs === 0) {
    registry.delete(connectionString);
    await entry.pool.end();
  }
}

/**
 * Lightweight reachability probe for the configured store. Every gateway turn
 * hits PG, so when it is down the long-poll stays alive but turns fail silently
 * (postmortem 2026-06-18 PG down). Returns ok=true with a sqlite note when no
 * DATABASE_URL is set.
 */
export async function probePgReachable(timeoutMs = 4000): Promise<{ ok: boolean; detail: string }> {
  const url = pgUrl();
  if (!url) return { ok: true, detail: "sqlite (CSAGENT_DATABASE_URL unset)" };
  const probe = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: timeoutMs });
  try {
    await probe.query("SELECT 1");
    return { ok: true, detail: "postgres reachable" };
  } catch (e) {
    // DB errors can embed the DSN password — redact before it reaches logs/status.
    return { ok: false, detail: `postgres unreachable: ${redact(e instanceof Error ? e.message : String(e))}` };
  } finally {
    await probe.end().catch(() => {});
  }
}
