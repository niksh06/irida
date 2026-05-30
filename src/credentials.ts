/**
 * Local API key storage under <stateDir>/credentials.json (default .agent/).
 * Env CURSOR_API_KEY wins for CI overrides. File is chmod 600; directory is gitignored.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";

export const CREDENTIALS_FILE = "credentials.json";
export const CREDENTIALS_VERSION = 1;

export type ApiKeySource = "env" | "file" | "none";

export interface ResolvedApiKey {
  key: string;
  source: ApiKeySource;
}

export interface CredentialsFile {
  version: number;
  cursor_api_key: string;
}

export const API_KEY_HELP =
  "Set CURSOR_API_KEY in the environment or run: csagent auth login --stdin";

/** Absolute path to the credentials file for a project. */
export function credentialsPath(dir: string = process.cwd()): string {
  const cfg = loadConfig(dir);
  return resolve(dir, cfg.stateDir, CREDENTIALS_FILE);
}

function readCredentialsFile(dir: string): string {
  const path = credentialsPath(dir);
  if (!existsSync(path)) return "";
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CredentialsFile>;
    const key = typeof parsed.cursor_api_key === "string" ? parsed.cursor_api_key.trim() : "";
    return key;
  } catch {
    return "";
  }
}

/** Resolve API key: environment overrides local file. */
export function resolveApiKey(dir: string = process.cwd()): ResolvedApiKey {
  const fromEnv = (process.env.CURSOR_API_KEY ?? "").trim();
  if (fromEnv) return { key: fromEnv, source: "env" };
  const fromFile = readCredentialsFile(dir);
  if (fromFile) return { key: fromFile, source: "file" };
  return { key: "", source: "none" };
}

export function hasStoredCredentials(dir: string = process.cwd()): boolean {
  return existsSync(credentialsPath(dir));
}

/** Persist key to credentials.json with mode 0600. */
export function saveCredentials(apiKey: string, dir: string = process.cwd()): void {
  const key = apiKey.trim();
  if (!key) throw new Error("API key must be a non-empty string");

  const cfg = loadConfig(dir);
  const stateRoot = resolve(dir, cfg.stateDir);
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  try {
    chmodSync(stateRoot, 0o700);
  } catch {
    // best-effort on platforms without Unix modes
  }

  const path = resolve(stateRoot, CREDENTIALS_FILE);
  const body: CredentialsFile = { version: CREDENTIALS_VERSION, cursor_api_key: key };
  writeFileSync(path, JSON.stringify(body, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best-effort */
  }
}

export function clearCredentials(dir: string = process.cwd()): boolean {
  const path = credentialsPath(dir);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

/** Doctor-friendly label without exposing the secret. */
export function apiKeySourceLabel(source: ApiKeySource, dir: string = process.cwd()): string {
  switch (source) {
    case "env":
      return "set (environment)";
    case "file":
      return `set (${loadConfig(dir).stateDir}/${CREDENTIALS_FILE})`;
    case "none":
      return `missing — export CURSOR_API_KEY or run csagent auth login --stdin`;
  }
}
