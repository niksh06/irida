/**
 * Postgres credential store — pgp_sym_encrypt / pgp_sym_decrypt (pgcrypto).
 * Active when CSAGENT_DATABASE_URL and CSAGENT_SECRETS_KEY are both set.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const SECRETS_KEY_ENV = "CSAGENT_SECRETS_KEY";

export const CREDENTIAL_SECRET_NAMES = ["cursor_api_key", "telegram_bot_token"] as const;
export type CredentialSecretName = (typeof CREDENTIAL_SECRET_NAMES)[number];

const CREDENTIALS_MIGRATION = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../deploy/postgres/migrations/004_credentials.sql"),
  "utf8"
);

let pool: pg.Pool | null = null;

export function pgSecretsEnabled(): boolean {
  return Boolean(process.env.CSAGENT_DATABASE_URL?.trim() && secretsKey());
}

export function secretsKey(): string {
  return (process.env[SECRETS_KEY_ENV] ?? "").trim();
}

function connectionString(): string {
  const url = process.env.CSAGENT_DATABASE_URL?.trim();
  if (!url) throw new Error("CSAGENT_DATABASE_URL is not set");
  return url;
}

function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: connectionString(), max: 3 });
  }
  return pool;
}

let migrated = false;

async function ensureMigrated(): Promise<void> {
  if (migrated) return;
  await getPool().query(CREDENTIALS_MIGRATION);
  migrated = true;
}

export async function loadPgCredentialSecrets(): Promise<Partial<Record<CredentialSecretName, string>>> {
  if (!pgSecretsEnabled()) return {};
  const key = secretsKey();
  await ensureMigrated();
  const res = await getPool().query(
    `SELECT name, pgp_sym_decrypt(ciphertext, $1) AS value
     FROM credential_secrets`,
    [key]
  );
  const out: Partial<Record<CredentialSecretName, string>> = {};
  for (const row of res.rows as Array<{ name: string; value: string | null }>) {
    const name = row.name as CredentialSecretName;
    const value = typeof row.value === "string" ? row.value.trim() : "";
    if (value) out[name] = value;
  }
  return out;
}

export async function setPgCredentialSecret(name: CredentialSecretName, value: string): Promise<void> {
  if (!pgSecretsEnabled()) {
    throw new Error(`${SECRETS_KEY_ENV} and CSAGENT_DATABASE_URL required for postgres credential store`);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new Error("secret value must be non-empty");
  const key = secretsKey();
  await ensureMigrated();
  await getPool().query(
    `INSERT INTO credential_secrets (name, ciphertext, updated_at)
     VALUES ($1, pgp_sym_encrypt($2, $3), NOW())
     ON CONFLICT (name) DO UPDATE SET
       ciphertext = EXCLUDED.ciphertext,
       updated_at = EXCLUDED.updated_at`,
    [name, trimmed, key]
  );
}

export async function deletePgCredentialSecret(name: CredentialSecretName): Promise<boolean> {
  if (!pgSecretsEnabled()) return false;
  await ensureMigrated();
  const res = await getPool().query(`DELETE FROM credential_secrets WHERE name = $1`, [name]);
  return (res.rowCount ?? 0) > 0;
}

export async function clearPgCredentialSecrets(): Promise<number> {
  if (!pgSecretsEnabled()) return 0;
  await ensureMigrated();
  const res = await getPool().query(`DELETE FROM credential_secrets`);
  return res.rowCount ?? 0;
}

export async function probePgCredentialStore(
  databaseUrl: string,
  secretsKeyValue: string
): Promise<{ ok: boolean; detail: string }> {
  const key = secretsKeyValue.trim();
  if (!key) return { ok: false, detail: `${SECRETS_KEY_ENV} empty` };
  const probePool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await probePool.query(CREDENTIALS_MIGRATION);
    const roundtrip = await probePool.query(
      `SELECT pgp_sym_decrypt(pgp_sym_encrypt($1, $2), $2) AS value`,
      ["probe", key]
    );
    const got = (roundtrip.rows[0] as { value?: string } | undefined)?.value;
    if (got !== "probe") {
      return { ok: false, detail: "pgcrypto roundtrip failed" };
    }
    return { ok: true, detail: "credential_secrets + pgcrypto ok" };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  } finally {
    await probePool.end();
  }
}

export async function closePgCredentialPool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
  migrated = false;
}
