import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  resolveApiKey,
  resolveAnthropicKey,
  resolveClaudeOAuthToken,
  resolveTelegramBotToken,
  saveCredentials,
  saveTelegramBotToken,
  clearCredentials,
  credentialsPath,
  CREDENTIALS_FILE,
} from "../src/credentials.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { cmdAuth } from "../src/auth_cmd.js";
import { cmdRun } from "../src/run.js";
import type { SdkLike } from "../src/host.js";

function withKey(value: string | undefined, fn: () => void | Promise<void>): Promise<void> {
  const prev = process.env.CURSOR_API_KEY;
  if (value === undefined) delete process.env.CURSOR_API_KEY;
  else process.env.CURSOR_API_KEY = value;
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prev;
  });
}

test("resolveApiKey prefers environment over file", async () => {
  await withKey(undefined, () => {
    const dir = mkdtempSync(resolve(tmpdir(), "cred-"));
    saveCredentials("file-key", dir);
    assert.deepEqual(resolveApiKey(dir), { key: "file-key", source: "file" });
  });
  await withKey("env-key", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "cred-env-"));
    saveCredentials("file-key", dir);
    assert.deepEqual(resolveApiKey(dir), { key: "env-key", source: "env" });
  });
});

test("resolveAnthropicKey: env over file over none", async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  try {
    const dir = mkdtempSync(resolve(tmpdir(), "anthropic-"));
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(resolveAnthropicKey(dir).source, "none");

    // file field
    const stateDir = resolve(dir, loadConfig(dir).stateDir);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      resolve(stateDir, CREDENTIALS_FILE),
      JSON.stringify({ version: 1, anthropic_api_key: "file-anthropic" })
    );
    assert.deepEqual(resolveAnthropicKey(dir), { key: "file-anthropic", source: "file" });

    process.env.ANTHROPIC_API_KEY = "env-anthropic";
    assert.deepEqual(resolveAnthropicKey(dir), { key: "env-anthropic", source: "env" });
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
  }
});

test("resolveClaudeOAuthToken: env over file over none", async () => {
  const prev = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  try {
    const dir = mkdtempSync(resolve(tmpdir(), "oauth-"));
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    assert.equal(resolveClaudeOAuthToken(dir).source, "none");

    const stateDir = resolve(dir, loadConfig(dir).stateDir);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      resolve(stateDir, CREDENTIALS_FILE),
      JSON.stringify({ version: 1, claude_code_oauth_token: "file-oauth" })
    );
    assert.deepEqual(resolveClaudeOAuthToken(dir), { key: "file-oauth", source: "file" });

    process.env.CLAUDE_CODE_OAUTH_TOKEN = "env-oauth";
    assert.deepEqual(resolveClaudeOAuthToken(dir), { key: "env-oauth", source: "env" });
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = prev;
  }
});

test("cmdRun claude-agent account: uses CLAUDE_CODE_OAUTH_TOKEN; empty does not block", async () => {
  const prevApi = process.env.ANTHROPIC_API_KEY;
  const prevOauth = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  await withKey(undefined, async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "engine-acct-"));
    writeFileSync(
      resolve(dir, "agent.config.json"),
      JSON.stringify({ engine: { provider: "claude-agent", auth: "account" } })
    );
    try {
      let seen: { apiKey?: string } = {};
      const sdk: SdkLike = {
        prompt: async (_m, opts) => {
          seen = { apiKey: opts.apiKey };
          return { status: "finished", result: "ok", id: "s", agentId: "s" };
        },
      };

      // token present → passed through
      delete process.env.ANTHROPIC_API_KEY;
      process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth-tok";
      assert.equal(await cmdRun("hi", { sdk, dir, barePrompt: true, persistRun: false, quiet: true }), 0);
      assert.equal(seen.apiKey, "oauth-tok");

      // no token → account mode still proceeds (SDK would use `claude login`)
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      assert.equal(await cmdRun("hi", { sdk, dir, barePrompt: true, persistRun: false, quiet: true }), 0);
      assert.equal(seen.apiKey, "");
    } finally {
      if (prevApi === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevApi;
      if (prevOauth === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      else process.env.CLAUDE_CODE_OAUTH_TOKEN = prevOauth;
    }
  });
});

test("saveCredentials writes mode 600 json", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "cred-mode-"));
  saveCredentials("cursor_test_secret", dir);
  const path = credentialsPath(dir);
  assert.ok(existsSync(path));
  const mode = statSync(path).mode & 0o777;
  assert.equal(mode, 0o600);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { cursor_api_key?: string };
  assert.equal(parsed.cursor_api_key, "cursor_test_secret");
  assert.ok(path.endsWith(CREDENTIALS_FILE));
});

test("clearCredentials removes file", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "cred-clear-"));
  saveCredentials("k", dir);
  assert.ok(clearCredentials(dir));
  assert.equal(resolveApiKey(dir).source, "none");
  assert.equal(clearCredentials(dir), false);
});

test("cmdRun works with file-stored key", async () => {
  await withKey(undefined, async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "cred-run-"));
    saveCredentials("stored-key", dir);
    const sdk: SdkLike = {
      prompt: async (_msg, opts) => {
        assert.equal(opts.apiKey, "stored-key");
        return { status: "finished", result: "ok", id: "r1", agentId: "a1" };
      },
    };
    assert.equal(await cmdRun("hi", { sdk, dir }), 0);
  });
});

test("cmdRun claude-agent engine: uses ANTHROPIC_API_KEY + claude default model", async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  await withKey(undefined, async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "cred-engine-"));
    writeFileSync(
      resolve(dir, "agent.config.json"),
      JSON.stringify({ engine: { provider: "claude-agent" } })
    );
    process.env.ANTHROPIC_API_KEY = "env-anthropic";
    try {
      let seen: { apiKey?: string; model?: string } = {};
      const sdk: SdkLike = {
        prompt: async (_msg, opts) => {
          seen = { apiKey: opts.apiKey, model: opts.model.id };
          return { status: "finished", result: "ok", id: "s1", agentId: "s1" };
        },
      };
      assert.equal(await cmdRun("hi", { sdk, dir, barePrompt: true, persistRun: false, quiet: true }), 0);
      assert.equal(seen.apiKey, "env-anthropic");
      assert.equal(seen.model, "claude-opus-4-8");
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});

test("auth login --from-env copies to file", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "cred-auth-"));
  await withKey("copy-me", async () => {
    assert.equal(await cmdAuth(["login", "--from-env"], dir), 0);
  });
  await withKey(undefined, () => {
    assert.deepEqual(resolveApiKey(dir), { key: "copy-me", source: "file" });
  });
});

test("auth status does not print key", async () => {
  await withKey(undefined, async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "cred-st-"));
    saveCredentials("super-secret-key", dir);
    const lines: string[] = [];
    const orig = console.log;
    console.log = (s: string) => lines.push(s);
    try {
      assert.equal(await cmdAuth(["status"], dir), 0);
    } finally {
      console.log = orig;
    }
    const out = lines.join("\n");
    assert.match(out, /CURSOR_API_KEY/);
    assert.doesNotMatch(out, /super-secret-key/);
  });
});

test("saveTelegramBotToken preserves cursor_api_key", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "cred-tg-"));
  saveCredentials("cursor-key", dir);
  saveTelegramBotToken("tg-token", dir);
  const parsed = JSON.parse(readFileSync(credentialsPath(dir), "utf8")) as {
    cursor_api_key?: string;
    telegram_bot_token?: string;
  };
  assert.equal(parsed.cursor_api_key, "cursor-key");
  assert.equal(parsed.telegram_bot_token, "tg-token");
});

test("resolveTelegramBotToken prefers environment", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "cred-tg-env-"));
  saveTelegramBotToken("file-tg", dir);
  const prev = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  try {
    assert.equal(resolveTelegramBotToken(dir).value, "file-tg");
    assert.equal(resolveTelegramBotToken(dir).source, "file");
    process.env.TELEGRAM_BOT_TOKEN = "env-tg";
    assert.equal(resolveTelegramBotToken(dir).value, "env-tg");
    assert.equal(resolveTelegramBotToken(dir).source, "env");
  } finally {
    if (prev === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prev;
  }
});

test("auth telegram login --from-env", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "cred-tg-auth-"));
  const prev = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "bot123";
  try {
    assert.equal(await cmdAuth(["telegram", "login", "--from-env"], dir), 0);
    delete process.env.TELEGRAM_BOT_TOKEN;
    assert.equal(resolveTelegramBotToken(dir).value, "bot123");
  } finally {
    if (prev === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prev;
  }
});
