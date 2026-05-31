/**
 * Local API key storage under <stateDir>/credentials.json (default .agent/).
 * Env vars win for CI overrides. File is chmod 600; directory is gitignored.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";

export const CREDENTIALS_FILE = "credentials.json";
export const CREDENTIALS_VERSION = 1;

export type SecretSource = "env" | "file" | "none";

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
  cursor_api_key?: string;
  telegram_bot_token?: string;
}

export const API_KEY_HELP =
  "Set CURSOR_API_KEY in the environment or run: csagent auth login --stdin";

export const TELEGRAM_TOKEN_HELP =
  "Set TELEGRAM_BOT_TOKEN in the environment or run: csagent auth telegram login --stdin";

/** Absolute path to the credentials file for a project. */
export function credentialsPath(dir: string = process.cwd()): string {
  const cfg = loadConfig(dir);
  return resolve(dir, cfg.stateDir, CREDENTIALS_FILE);
}

export function readCredentialsFile(dir: string = process.cwd()): CredentialsFile {
  const path = credentialsPath(dir);
  if (!existsSync(path)) return { version: CREDENTIALS_VERSION };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CredentialsFile>;
    const out: CredentialsFile = { version: CREDENTIALS_VERSION };
    if (typeof parsed.cursor_api_key === "string" && parsed.cursor_api_key.trim()) {
      out.cursor_api_key = parsed.cursor_api_key.trim();
    }
    if (typeof parsed.telegram_bot_token === "string" && parsed.telegram_bot_token.trim()) {
      out.telegram_bot_token = parsed.telegram_bot_token.trim();
    }
    return out;
  } catch {
    return { version: CREDENTIALS_VERSION };
  }
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
  if (data.cursor_api_key?.trim()) body.cursor_api_key = data.cursor_api_key.trim();
  if (data.telegram_bot_token?.trim()) body.telegram_bot_token = data.telegram_bot_token.trim();

  if (!body.cursor_api_key && !body.telegram_bot_token) {
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

/** Resolve API key: environment overrides local file. */
export function resolveApiKey(dir: string = process.cwd()): ResolvedApiKey {
  const fromEnv = (process.env.CURSOR_API_KEY ?? "").trim();
  if (fromEnv) return { key: fromEnv, source: "env" };
  const fromFile = readCredentialsFile(dir).cursor_api_key ?? "";
  if (fromFile) return { key: fromFile, source: "file" };
  return { key: "", source: "none" };
}

/** Resolve Telegram bot token: environment overrides local file. */
export function resolveTelegramBotToken(
  dir: string = process.cwd(),
  envName: string = "TELEGRAM_BOT_TOKEN"
): ResolvedSecret {
  const name = envName.trim() || "TELEGRAM_BOT_TOKEN";
  const fromEnv = (process.env[name] ?? "").trim();
  if (fromEnv) return { value: fromEnv, source: "env" };
  const fromFile = readCredentialsFile(dir).telegram_bot_token ?? "";
  if (fromFile) return { value: fromFile, source: "file" };
  return { value: "", source: "none" };
}

export function hasStoredCredentials(dir: string = process.cwd()): boolean {
  return existsSync(credentialsPath(dir));
}

export function hasStoredTelegramToken(dir: string = process.cwd()): boolean {
  return Boolean(readCredentialsFile(dir).telegram_bot_token);
}

/** Persist Cursor API key; preserves other secrets in the same file. */
export function saveCredentials(apiKey: string, dir: string = process.cwd()): void {
  const key = apiKey.trim();
  if (!key) throw new Error("API key must be a non-empty string");
  const existing = readCredentialsFile(dir);
  writeCredentialsFile(dir, { ...existing, cursor_api_key: key });
}

/** Persist Telegram bot token; preserves other secrets in the same file. */
export function saveTelegramBotToken(token: string, dir: string = process.cwd()): void {
  const value = token.trim();
  if (!value) throw new Error("Telegram bot token must be a non-empty string");
  const existing = readCredentialsFile(dir);
  writeCredentialsFile(dir, { ...existing, telegram_bot_token: value });
}

export function clearCredentials(dir: string = process.cwd()): boolean {
  const path = credentialsPath(dir);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export function clearTelegramBotToken(dir: string = process.cwd()): boolean {
  const existing = readCredentialsFile(dir);
  if (!existing.telegram_bot_token) return false;
  const next = { ...existing };
  delete next.telegram_bot_token;
  writeCredentialsFile(dir, next);
  return true;
}

export function clearCursorApiKey(dir: string = process.cwd()): boolean {
  const existing = readCredentialsFile(dir);
  if (!existing.cursor_api_key) return false;
  const next = { ...existing };
  delete next.cursor_api_key;
  writeCredentialsFile(dir, next);
  return true;
}

/** Doctor-friendly label without exposing the secret. */
export function apiKeySourceLabel(source: SecretSource, dir: string = process.cwd()): string {
  switch (source) {
    case "env":
      return "set (environment)";
    case "file":
      return `set (${loadConfig(dir).stateDir}/${CREDENTIALS_FILE})`;
    case "none":
      return `missing — export CURSOR_API_KEY or run csagent auth login --stdin`;
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
    case "file":
      return `set (${loadConfig(dir).stateDir}/${CREDENTIALS_FILE})`;
    case "none":
      return `missing — export ${envName} or run csagent auth telegram login --stdin`;
  }
}
