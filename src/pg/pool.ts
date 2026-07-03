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
  if (!url) throw new Error("IRIDA_DATABASE_URL is not set (legacy CSAGENT_DATABASE_URL also honored)");
  return url;
}

const registry = new Map<string, { pool: pg.Pool; refs: number }>();

/** Bound connect attempts instead of hanging forever on a stuck server (I-137). */
const PG_CONNECT_TIMEOUT_MS = 10_000;

/** Acquire a ref-counted pool for a connection string (first caller sets max). */
export function acquirePgPool(connectionString: string, max = DEFAULT_PG_MAX): pg.Pool {
  let entry = registry.get(connectionString);
  if (!entry) {
    entry = {
      pool: new pg.Pool({ connectionString, max, connectionTimeoutMillis: PG_CONNECT_TIMEOUT_MS }),
      refs: 0,
    };
    // node-postgres emits 'error' on the pool when an IDLE client dies (PG
    // restart, Docker flap — a known condition on this prod host). With no
    // listener that is an uncaught 'error' event → process crash mid-work
    // (I-137). Log it; the pool replaces dead clients on next checkout.
    entry.pool.on("error", (e) => {
      console.error(`[pg] idle client error (pool continues): ${redact(e.message)}`);
    });
    registry.set(connectionString, entry);
  }
  entry.refs += 1;
  return entry.pool;
}

const TRANSIENT_PG_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now (server starting up)
  "08006", // connection_failure
  "08001", // sqlclient_unable_to_establish_sqlconnection
]);

/** Connection-level errors that a short retry can plausibly clear. */
export function isTransientPgError(e: unknown): boolean {
  if (e == null) return false;
  const code = (e as { code?: unknown }).code;
  if (typeof code === "string" && TRANSIENT_PG_CODES.has(code)) return true;
  // Node multi-address connects (localhost → v4+v6) surface as AggregateError.
  const errors = (e as { errors?: unknown[] }).errors;
  if (Array.isArray(errors) && errors.some((x) => isTransientPgError(x))) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|connection terminated|timeout expired/i.test(
    msg
  );
}

/**
 * Bounded retry for transient connection-level PG errors (I-137). Use on
 * READ/idempotent paths only — a non-idempotent write may have applied before
 * a mid-flight connection drop. First consumer: credentials warm at process
 * start, where one blip otherwise cold-caches secrets for the process's life.
 */
export async function withPgRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; delayMs?: number; label?: string } = {}
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const delayMs = opts.delayMs ?? 500;
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isTransientPgError(e) || i === attempts) throw e;
      console.error(
        `[pg] transient error${opts.label ? ` (${opts.label})` : ""} — retry ${i}/${attempts - 1} in ${delayMs}ms: ${redact(
          e instanceof Error ? e.message : String(e)
        )}`
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
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
