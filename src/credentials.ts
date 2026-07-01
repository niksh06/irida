/**
 * Local API key storage under <stateDir>/credentials.json (default .agent/).
 * With CSAGENT_DATABASE_URL + CSAGENT_SECRETS_KEY: secrets live in Postgres (pgcrypto).
 * Env vars win for CI overrides. Plaintext file is chmod 600; directory is gitignored.
 *
 * Arch-7 note: the `if (pgSecretsEnabled())` branches here are deliberately NOT
 * collapsed into a single polymorphic SecretStore. The two backends differ in
 * behavior, not just storage — the PG path manages an in-memory cache, strips
 * the plaintext file copy, migrates on warm, and validates secret format, while
 * the lenient `save*` file API skips validation (and is tested as such). Read
 * resolution is already a precedence chain (env → pg cache → file), not a
 * branch. These distinctions were hardened by the 2026-06 split-brain/self-heal
 * postmortems; unify with care.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { redact } from "./redact.js";
import { withPgRetry } from "./pg/pool.js";
import {
  CREDENTIAL_SECRET_NAMES,
  type CredentialSecretName,
  clearPgCredentialSecrets,
  deletePgCredentialSecret,
  loadPgCredentialSecrets,
  pgSecretsEnabled,
  setPgCredentialSecret,
} from "./credentialsPg.js";

export { pgSecretsEnabled, SECRETS_KEY_ENV } from "./credentialsPg.js";

export const CREDENTIALS_FILE = "credentials.json";
export const CREDENTIALS_VERSION = 1;

export type SecretSource = "env" | "file" | "pg" | "none";

/** @deprecated use SecretSource */
export type ApiKeySource = SecretSource;

export interface ResolvedApiKey {
  key: string;
  source: SecretSource;
}

export interface ResolvedSecret {
  value: string;
  source: SecretSource;
}

export interface CredentialsFile {
  version: number;
  storage?: "pg";
  cursor_api_key?: string;
  telegram_bot_token?: string;
  anthropic_api_key?: string;
  claude_code_oauth_token?: string;
}

export const API_KEY_HELP =
  "Set CURSOR_API_KEY in the environment or run: irida auth login --stdin";

export const ANTHROPIC_API_KEY_HELP =
  "claude-agent engine (auth=api-key): set ANTHROPIC_API_KEY in the environment";

export const CLAUDE_OAUTH_HELP =
  "claude-agent engine (auth=account): connect your Claude account — run `claude setup-token` and set CLAUDE_CODE_OAUTH_TOKEN, or run `claude login` (the SDK reads ~/.claude/.credentials.json)";

export const TELEGRAM_TOKEN_HELP =
  "Set TELEGRAM_BOT_TOKEN in the environment or run: irida auth telegram login --stdin";

export interface SecretFormatCheck {
  ok: boolean;
  detail: string;
}

/** Shape check only — does not call external APIs. Never logs the secret. */
export function validateCursorApiKeyFormat(key: string): SecretFormatCheck {
  const k = key.trim();
  if (k.length < 20) {
    return {
      ok: false,
      detail: `too short (${k.length} chars) — likely corrupt decryption or wrong secret`,
    };
  }
  if (/^(crsr_|cursor_|key_)/.test(k) || k.startsWith("sk-")) {
    return { ok: true, detail: "ok" };
  }
  if (k.length >= 40) return { ok: true, detail: "ok" };
  return {
    ok: false,
    detail: `unexpected shape (${k.length} chars) — expected crsr_/cursor_ prefix or length ≥40`,
  };
}

/** Bot API tokens are `{bot_id}:{secret}` (~46 chars). Catches PG garbage like 6-char blobs. */
export function validateTelegramBotTokenFormat(token: string): SecretFormatCheck {
  const t = token.trim();
  if (t.length < 35) {
    return {
      ok: false,
      detail: `too short (${t.length} chars) — Bot API tokens are typically ~46 chars`,
    };
  }
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(t)) {
    return { ok: false, detail: "invalid shape — expected bot_id:secret (digits:alnum)" };
  }
  return { ok: true, detail: "ok" };
}

let pgSecretsCache: Partial<Record<CredentialSecretName, string>> | null = null;
let pgCacheReady = false;

/** Absolute path to the credentials file for a project. */
export function credentialsPath(dir: string = process.cwd()): string {
  const cfg = loadConfig(dir);
  return resolve(dir, cfg.stateDir, CREDENTIALS_FILE);
}

function readCredentialsFileFromDisk(dir: string = process.cwd()): CredentialsFile {
  const path = credentialsPath(dir);
  if (!existsSync(path)) return { version: CREDENTIALS_VERSION };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CredentialsFile>;
    const out: CredentialsFile = { version: CREDENTIALS_VERSION };
    if (parsed.storage === "pg") out.storage = "pg";
    if (typeof parsed.cursor_api_key === "string" && parsed.cursor_api_key.trim()) {
      out.cursor_api_key = parsed.cursor_api_key.trim();
    }
    if (typeof parsed.telegram_bot_token === "string" && parsed.telegram_bot_token.trim()) {
      out.telegram_bot_token = parsed.telegram_bot_token.trim();
    }
    if (typeof parsed.anthropic_api_key === "string" && parsed.anthropic_api_key.trim()) {
      out.anthropic_api_key = parsed.anthropic_api_key.trim();
    }
    if (typeof parsed.claude_code_oauth_token === "string" && parsed.claude_code_oauth_token.trim()) {
      out.claude_code_oauth_token = parsed.claude_code_oauth_token.trim();
    }
    return out;
  } catch {
    return { version: CREDENTIALS_VERSION };
  }
}

/** Read credentials.json from disk (plaintext fields only; does not hit Postgres). */
export function readCredentialsFile(dir: string = process.cwd()): CredentialsFile {
  return readCredentialsFileFromDisk(dir);
}

function writeCredentialsFile(dir: string, data: CredentialsFile): void {
  const cfg = loadConfig(dir);
  const stateRoot = resolve(dir, cfg.stateDir);
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  try {
    chmodSync(stateRoot, 0o700);
  } catch {
    // best-effort on platforms without Unix modes
  }

  const path = resolve(stateRoot, CREDENTIALS_FILE);
  const body: CredentialsFile = { version: CREDENTIALS_VERSION };
  if (data.storage === "pg") body.storage = "pg";
  if (data.cursor_api_key?.trim()) body.cursor_api_key = data.cursor_api_key.trim();
  if (data.telegram_bot_token?.trim()) body.telegram_bot_token = data.telegram_bot_token.trim();
  if (data.anthropic_api_key?.trim()) body.anthropic_api_key = data.anthropic_api_key.trim();
  if (data.claude_code_oauth_token?.trim()) body.claude_code_oauth_token = data.claude_code_oauth_token.trim();

  if (
    !body.cursor_api_key &&
    !body.telegram_bot_token &&
    !body.anthropic_api_key &&
    !body.claude_code_oauth_token &&
    body.storage !== "pg"
  ) {
    if (existsSync(path)) unlinkSync(path);
    return;
  }

  writeFileSync(path, JSON.stringify(body, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best-effort */
  }
}

function stripPlaintextSecretFromFile(dir: string, name: CredentialSecretName): void {
  const existing = readCredentialsFileFromDisk(dir);
  const next: CredentialsFile = { version: CREDENTIALS_VERSION };
  if (pgSecretsEnabled()) next.storage = "pg";
  if (name !== "cursor_api_key" && existing.cursor_api_key) next.cursor_api_key = existing.cursor_api_key;
  if (name !== "telegram_bot_token" && existing.telegram_bot_token) {
    next.telegram_bot_token = existing.telegram_bot_token;
  }
  writeCredentialsFile(dir, next);
}

function pgCachedSecret(name: CredentialSecretName): string {
  if (!pgSecretsEnabled() || !pgCacheReady || !pgSecretsCache) return "";
  return pgSecretsCache[name] ?? "";
}

function checkSecretFormat(name: CredentialSecretName, value: string): SecretFormatCheck {
  return name === "cursor_api_key"
    ? validateCursorApiKeyFormat(value)
    : validateTelegramBotTokenFormat(value);
}

/**
 * Read-path format guard (I-136). A corrupt stored value (the I-132 incident:
 * a 6-char blob from credentials.json) passes `if (!token)` guards and reaches
 * the Telegram API as `bot<garbage>/…` → opaque 404. Scope, per the Arch-7 note
 * above: env is never validated (explicit user override, doctor flags shape),
 * and in file-only mode the lenient file API stays lenient on read too — the
 * garbage class this guards against is a PG-mode artifact (failed decrypt /
 * split-brain residue mirrored to the file fallback).
 */
function guardResolvedSecret(
  name: CredentialSecretName,
  value: string,
  source: "pg" | "file"
): string {
  if (!value) return "";
  if (source === "file" && !pgSecretsEnabled()) return value;
  const fmt = checkSecretFormat(name, value);
  if (fmt.ok) return value;
  const where = source === "pg" ? "postgres" : "credentials.json";
  const hint = name === "cursor_api_key" ? "irida auth login --stdin" : "irida auth telegram login --stdin";
  console.error(
    `[credentials] ${name} from ${where} is corrupt (${fmt.detail}) — ignoring; re-save with: ${hint}`
  );
  return "";
}

/** Load encrypted secrets from Postgres; migrate plaintext file on first run. */
export async function warmCredentialsCache(dir: string = process.cwd()): Promise<void> {
  if (!pgSecretsEnabled()) {
    pgSecretsCache = null;
    pgCacheReady = false;
    return;
  }
  try {
    // A transient PG blip at process start must not cold-cache secrets for the
    // whole process lifetime (gateway warms exactly once) — retry briefly (I-137).
    const loaded = await withPgRetry(() => loadPgCredentialSecrets(), { label: "credentials warm" });
    const file = readCredentialsFileFromDisk(dir);
    let migrated = false;
    for (const name of CREDENTIAL_SECRET_NAMES) {
      if (!loaded[name] && file[name]) {
        // Migration guard (I-136): never push a corrupt file value into PG —
        // this path bypasses persistSecret's validation and would launder the
        // I-132 garbage class into the "trusted" store.
        const fileFmt = checkSecretFormat(name, file[name]!);
        if (!fileFmt.ok) {
          console.error(
            `[credentials] skip migrating ${name} to postgres: file value is corrupt (${fileFmt.detail})`
          );
          continue;
        }
        await setPgCredentialSecret(name, file[name]!);
        loaded[name] = file[name];
        migrated = true;
        continue;
      }
      // Self-heal read path (postmortem 2026-06-12): PG holds a corrupt value
      // (short garbage that decrypts fine) while the file copy is valid —
      // prefer the valid file value and say so. Write-back stays explicit.
      if (loaded[name] && file[name]) {
        const fmt = checkSecretFormat(name, loaded[name]!);
        const fileFmt = checkSecretFormat(name, file[name]!);
        if (!fmt.ok && fileFmt.ok) {
          console.error(
            `[credentials] ${name} in postgres is corrupt (${fmt.detail}); using valid file value — re-save with: irida auth ${name === "cursor_api_key" ? "login" : "telegram login"} --stdin`
          );
          loaded[name] = file[name];
        }
      }
    }
    if (migrated) {
      writeCredentialsFile(dir, { version: CREDENTIALS_VERSION, storage: "pg" });
    } else if (Object.keys(loaded).length > 0 || file.storage === "pg") {
      const hasPlain = Boolean(file.cursor_api_key || file.telegram_bot_token);
      if (!hasPlain && file.storage !== "pg") {
        writeCredentialsFile(dir, { version: CREDENTIALS_VERSION, storage: "pg" });
      }
    }
    pgSecretsCache = loaded;
    pgCacheReady = true;
  } catch (e) {
    // Postgres unavailable — fall back to plaintext credentials.json if present.
    // Say so loudly (I-136): this silent catch was link #1 of the I-132 chain
    // (dead DB → cold cache → garbage file token → opaque Telegram 404).
    pgSecretsCache = null;
    pgCacheReady = false;
    console.error(
      `[credentials] warm cache failed — postgres unavailable, falling back to credentials.json: ${redact(
        e instanceof Error ? e.message : String(e)
      )}`
    );
  }
}

async function persistSecret(name: CredentialSecretName, value: string, dir: string): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("secret must be a non-empty string");
  const fmt =
    name === "cursor_api_key"
      ? validateCursorApiKeyFormat(trimmed)
      : validateTelegramBotTokenFormat(trimmed);
  if (!fmt.ok) {
    throw new Error(`refusing to save ${name}: ${fmt.detail}`);
  }
  if (pgSecretsEnabled()) {
    await setPgCredentialSecret(name, trimmed);
    pgSecretsCache = { ...(pgSecretsCache ?? {}), [name]: trimmed };
    pgCacheReady = true;
    stripPlaintextSecretFromFile(dir, name);
    return;
  }
  const existing = readCredentialsFileFromDisk(dir);
  writeCredentialsFile(dir, { ...existing, [name]: trimmed });
}

/** Resolve API key: environment overrides postgres/file. */
export function resolveApiKey(dir: string = process.cwd()): ResolvedApiKey {
  const fromEnv = (process.env.CURSOR_API_KEY ?? "").trim();
  if (fromEnv) return { key: fromEnv, source: "env" };
  const fromPg = guardResolvedSecret("cursor_api_key", pgCachedSecret("cursor_api_key"), "pg");
  if (fromPg) return { key: fromPg, source: "pg" };
  const fromFile = guardResolvedSecret(
    "cursor_api_key",
    readCredentialsFileFromDisk(dir).cursor_api_key ?? "",
    "file"
  );
  if (fromFile) return { key: fromFile, source: "file" };
  return { key: "", source: "none" };
}

/**
 * Resolve the Anthropic API key for the claude-agent engine (I-100).
 * Env `ANTHROPIC_API_KEY` overrides the plaintext credentials.json field.
 * (pg-encrypted storage is intentionally not wired yet — env is the primary path,
 * and the Claude Agent SDK reads `ANTHROPIC_API_KEY` from the environment.)
 */
export function resolveAnthropicKey(dir: string = process.cwd()): ResolvedApiKey {
  const fromEnv = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (fromEnv) return { key: fromEnv, source: "env" };
  const fromFile = readCredentialsFileFromDisk(dir).anthropic_api_key ?? "";
  if (fromFile) return { key: fromFile, source: "file" };
  return { key: "", source: "none" };
}

/**
 * Resolve the Claude account OAuth token for the claude-agent engine (auth=account, I-100).
 * Env `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) overrides the plaintext
 * credentials.json field. May legitimately return "none": when no token is stored, the
 * Agent SDK falls back to an existing `claude login` session (~/.claude/.credentials.json),
 * so callers should NOT hard-fail on an empty token in account mode.
 */
export function resolveClaudeOAuthToken(dir: string = process.cwd()): ResolvedApiKey {
  const fromEnv = (process.env.CLAUDE_CODE_OAUTH_TOKEN ?? "").trim();
  if (fromEnv) return { key: fromEnv, source: "env" };
  const fromFile = readCredentialsFileFromDisk(dir).claude_code_oauth_token ?? "";
  if (fromFile) return { key: fromFile, source: "file" };
  return { key: "", source: "none" };
}

/** Resolve Telegram bot token: environment overrides postgres/file. */
export function resolveTelegramBotToken(
  dir: string = process.cwd(),
  envName: string = "TELEGRAM_BOT_TOKEN"
): ResolvedSecret {
  const name = envName.trim() || "TELEGRAM_BOT_TOKEN";
  const fromEnv = (process.env[name] ?? "").trim();
  if (fromEnv) return { value: fromEnv, source: "env" };
  const fromPg = guardResolvedSecret("telegram_bot_token", pgCachedSecret("telegram_bot_token"), "pg");
  if (fromPg) return { value: fromPg, source: "pg" };
  const fromFile = guardResolvedSecret(
    "telegram_bot_token",
    readCredentialsFileFromDisk(dir).telegram_bot_token ?? "",
    "file"
  );
  if (fromFile) return { value: fromFile, source: "file" };
  return { value: "", source: "none" };
}

export function hasPlaintextCredentialsOnDisk(dir: string = process.cwd()): boolean {
  const file = readCredentialsFileFromDisk(dir);
  return Boolean(file.cursor_api_key || file.telegram_bot_token);
}

export function hasStoredCredentials(dir: string = process.cwd()): boolean {
  if (pgSecretsEnabled() && pgCacheReady && pgSecretsCache && Object.keys(pgSecretsCache).length > 0) {
    return true;
  }
  return existsSync(credentialsPath(dir));
}

export function hasStoredTelegramToken(dir: string = process.cwd()): boolean {
  if (pgCachedSecret("telegram_bot_token")) return true;
  return Boolean(readCredentialsFileFromDisk(dir).telegram_bot_token);
}

/** Persist Cursor API key; preserves other secrets. */
export function saveCredentials(apiKey: string, dir: string = process.cwd()): void {
  const key = apiKey.trim();
  if (!key) throw new Error("API key must be a non-empty string");
  if (pgSecretsEnabled()) {
    throw new Error("saveCredentials: use persistCursorApiKey when CSAGENT_SECRETS_KEY is set");
  }
  const existing = readCredentialsFileFromDisk(dir);
  writeCredentialsFile(dir, { ...existing, cursor_api_key: key });
}

export async function persistCursorApiKey(apiKey: string, dir: string = process.cwd()): Promise<void> {
  await persistSecret("cursor_api_key", apiKey, dir);
}

/** Persist the Anthropic API key (claude-agent engine, file storage). Preserves other secrets. */
export function saveAnthropicApiKey(key: string, dir: string = process.cwd()): void {
  const v = key.trim();
  if (!v) throw new Error("Anthropic API key must be a non-empty string");
  const existing = readCredentialsFileFromDisk(dir);
  writeCredentialsFile(dir, { ...existing, anthropic_api_key: v });
}

export function clearAnthropicApiKey(dir: string = process.cwd()): boolean {
  const existing = readCredentialsFileFromDisk(dir);
  if (!existing.anthropic_api_key) return false;
  const next = { ...existing };
  delete next.anthropic_api_key;
  writeCredentialsFile(dir, next);
  return true;
}

/** Persist the Claude account OAuth token (claude-agent engine, file storage). Preserves other secrets. */
export function saveClaudeOAuthToken(token: string, dir: string = process.cwd()): void {
  const v = token.trim();
  if (!v) throw new Error("Claude OAuth token must be a non-empty string");
  const existing = readCredentialsFileFromDisk(dir);
  writeCredentialsFile(dir, { ...existing, claude_code_oauth_token: v });
}

export function clearClaudeOAuthToken(dir: string = process.cwd()): boolean {
  const existing = readCredentialsFileFromDisk(dir);
  if (!existing.claude_code_oauth_token) return false;
  const next = { ...existing };
  delete next.claude_code_oauth_token;
  writeCredentialsFile(dir, next);
  return true;
}

/** Persist Telegram bot token; preserves other secrets. */
export function saveTelegramBotToken(token: string, dir: string = process.cwd()): void {
  const value = token.trim();
  if (!value) throw new Error("Telegram bot token must be a non-empty string");
  if (pgSecretsEnabled()) {
    throw new Error("saveTelegramBotToken: use persistTelegramBotToken when CSAGENT_SECRETS_KEY is set");
  }
  const existing = readCredentialsFileFromDisk(dir);
  writeCredentialsFile(dir, { ...existing, telegram_bot_token: value });
}

export async function persistTelegramBotToken(token: string, dir: string = process.cwd()): Promise<void> {
  await persistSecret("telegram_bot_token", token, dir);
}

export function clearCredentials(dir: string = process.cwd()): boolean {
  if (pgSecretsEnabled()) {
    throw new Error("clearCredentials: use clearAllStoredCredentials when CSAGENT_SECRETS_KEY is set");
  }
  const path = credentialsPath(dir);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export async function clearAllStoredCredentials(dir: string = process.cwd()): Promise<boolean> {
  let removed = false;
  if (pgSecretsEnabled()) {
    const n = await clearPgCredentialSecrets();
    pgSecretsCache = {};
    pgCacheReady = true;
    removed = n > 0;
  }
  const path = credentialsPath(dir);
  if (existsSync(path)) {
    unlinkSync(path);
    removed = true;
  }
  return removed;
}

export function clearTelegramBotToken(dir: string = process.cwd()): boolean {
  if (pgSecretsEnabled()) {
    throw new Error("clearTelegramBotToken: use clearStoredTelegramToken when CSAGENT_SECRETS_KEY is set");
  }
  const existing = readCredentialsFileFromDisk(dir);
  if (!existing.telegram_bot_token) return false;
  const next = { ...existing };
  delete next.telegram_bot_token;
  writeCredentialsFile(dir, next);
  return true;
}

export async function clearStoredTelegramToken(dir: string = process.cwd()): Promise<boolean> {
  let removed = false;
  if (pgSecretsEnabled()) {
    removed = (await deletePgCredentialSecret("telegram_bot_token")) || removed;
    if (pgSecretsCache) delete pgSecretsCache.telegram_bot_token;
    pgCacheReady = true;
    stripPlaintextSecretFromFile(dir, "telegram_bot_token");
  } else {
    removed = clearTelegramBotToken(dir);
  }
  return removed;
}

export function clearCursorApiKey(dir: string = process.cwd()): boolean {
  if (pgSecretsEnabled()) {
    throw new Error("clearCursorApiKey: use clearStoredCursorApiKey when CSAGENT_SECRETS_KEY is set");
  }
  const existing = readCredentialsFileFromDisk(dir);
  if (!existing.cursor_api_key) return false;
  const next = { ...existing };
  delete next.cursor_api_key;
  writeCredentialsFile(dir, next);
  return true;
}

export async function clearStoredCursorApiKey(dir: string = process.cwd()): Promise<boolean> {
  let removed = false;
  if (pgSecretsEnabled()) {
    removed = (await deletePgCredentialSecret("cursor_api_key")) || removed;
    if (pgSecretsCache) delete pgSecretsCache.cursor_api_key;
    pgCacheReady = true;
    stripPlaintextSecretFromFile(dir, "cursor_api_key");
  } else {
    removed = clearCursorApiKey(dir);
  }
  return removed;
}

/** Doctor-friendly label without exposing the secret. */
export function apiKeySourceLabel(source: SecretSource, dir: string = process.cwd()): string {
  switch (source) {
    case "env":
      return "set (environment)";
    case "pg":
      return "set (postgres credential_secrets, pgcrypto)";
    case "file":
      return `set (${loadConfig(dir).stateDir}/${CREDENTIALS_FILE})`;
    case "none":
      return `missing — export CURSOR_API_KEY or run irida auth login --stdin`;
  }
}

export function telegramTokenSourceLabel(
  source: SecretSource,
  dir: string = process.cwd(),
  envName: string = "TELEGRAM_BOT_TOKEN"
): string {
  switch (source) {
    case "env":
      return `set (environment ${envName})`;
    case "pg":
      return "set (postgres credential_secrets, pgcrypto)";
    case "file":
      return `set (${loadConfig(dir).stateDir}/${CREDENTIALS_FILE})`;
    case "none":
      return `missing — export ${envName} or run irida auth telegram login --stdin`;
  }
}
