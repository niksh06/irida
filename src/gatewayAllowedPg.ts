/**
 * Postgres gateway allowlist — chat IDs encrypted at rest (pgcrypto).
 * Active when CSAGENT_DATABASE_URL and CSAGENT_SECRETS_KEY are both set.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { pgSecretsEnabled, secretsKey } from "./credentialsPg.js";
import { acquirePgPool, pgConnectionString, releasePgPool } from "./pg/pool.js";
import { runPgMigrations } from "./pg/migrations.js";

export type GatewayAllowSource = "allowlist" | "pairing";

// Schema is applied by the tracked runner (src/pg/migrations.ts, I-141). The
// constant below stays for the standalone doctor probe pool only.
const GATEWAY_ALLOWED_MIGRATION = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../deploy/postgres/migrations/010_gateway_allowed_chats.sql"),
  "utf8"
);

let pool: pg.Pool | null = null;
let migrated = false;

function getPool(): pg.Pool {
  if (!pool) {
    pool = acquirePgPool(pgConnectionString());
  }
  return pool;
}

async function ensureMigrated(): Promise<void> {
  if (migrated) return;
  await runPgMigrations(getPool(), pgConnectionString());
  migrated = true;
}

export function pgGatewayAllowlistEnabled(): boolean {
  return pgSecretsEnabled();
}

export interface PgAllowedChatRow {
  chatId: string;
  adapter: string;
  source: GatewayAllowSource;
}

async function loadRows(): Promise<PgAllowedChatRow[]> {
  if (!pgGatewayAllowlistEnabled()) return [];
  const key = secretsKey();
  await ensureMigrated();
  const res = await getPool().query(
    `SELECT adapter, source, pgp_sym_decrypt(ciphertext, $1) AS chat_id
     FROM gateway_allowed_chats
     ORDER BY id ASC`,
    [key]
  );
  const out: PgAllowedChatRow[] = [];
  for (const row of res.rows as Array<{
    adapter: string;
    source: string;
    chat_id: string | null;
  }>) {
    const chatId = typeof row.chat_id === "string" ? row.chat_id.trim() : "";
    if (!chatId) continue;
    const source = row.source === "pairing" ? "pairing" : "allowlist";
    out.push({ chatId, adapter: row.adapter || "telegram", source });
  }
  return out;
}

/** Decrypted chat IDs for gateway auth (all adapters). */
export async function loadPgAllowedChatIds(): Promise<string[]> {
  const rows = await loadRows();
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of rows) {
    if (seen.has(row.chatId)) continue;
    seen.add(row.chatId);
    ids.push(row.chatId);
  }
  return ids;
}

export async function addPgAllowedChatId(
  chatId: string,
  opts: { adapter?: string; source?: GatewayAllowSource } = {}
): Promise<boolean> {
  if (!pgGatewayAllowlistEnabled()) {
    throw new Error("CSAGENT_DATABASE_URL + CSAGENT_SECRETS_KEY required for postgres gateway allowlist");
  }
  const trimmed = chatId.trim();
  if (!trimmed) throw new Error("chatId must be non-empty");
  const existing = await loadPgAllowedChatIds();
  if (existing.includes(trimmed)) return false;
  const adapter = (opts.adapter ?? "telegram").trim() || "telegram";
  const source: GatewayAllowSource = opts.source === "pairing" ? "pairing" : "allowlist";
  const key = secretsKey();
  await ensureMigrated();
  await getPool().query(
    `INSERT INTO gateway_allowed_chats (adapter, ciphertext, source, created_at)
     VALUES ($1, pgp_sym_encrypt($2, $3), $4, NOW())`,
    [adapter, trimmed, key, source]
  );
  return true;
}

export async function probePgGatewayAllowlist(
  databaseUrl: string,
  secretsKeyValue: string
): Promise<{ ok: boolean; detail: string }> {
  const key = secretsKeyValue.trim();
  if (!key) return { ok: false, detail: "CSAGENT_SECRETS_KEY empty" };
  const probePool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await probePool.query(GATEWAY_ALLOWED_MIGRATION);
    const roundtrip = await probePool.query(
      `SELECT pgp_sym_decrypt(pgp_sym_encrypt($1, $2), $2) AS value`,
      ["probe-chat", key]
    );
    const got = (roundtrip.rows[0] as { value?: string } | undefined)?.value;
    if (got !== "probe-chat") {
      return { ok: false, detail: "pgcrypto roundtrip failed" };
    }
    const count = await probePool.query(`SELECT COUNT(*)::int AS n FROM gateway_allowed_chats`);
    const n = (count.rows[0] as { n?: number } | undefined)?.n ?? 0;
    return { ok: true, detail: `gateway_allowed_chats + pgcrypto ok (${n} peer(s))` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  } finally {
    await probePool.end();
  }
}

export async function removePgAllowedChatId(chatId: string): Promise<boolean> {
  if (!pgGatewayAllowlistEnabled()) return false;
  const trimmed = chatId.trim();
  if (!trimmed) return false;
  const key = secretsKey();
  await ensureMigrated();
  const res = await getPool().query(
    `DELETE FROM gateway_allowed_chats
     WHERE pgp_sym_decrypt(ciphertext, $1) = $2`,
    [key, trimmed]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function closePgGatewayAllowlistPool(): Promise<void> {
  if (!pool) return;
  await releasePgPool(pgConnectionString());
  pool = null;
  migrated = false;
}
