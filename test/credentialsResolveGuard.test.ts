import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveApiKey, resolveTelegramBotToken } from "../src/credentials.js";

// I-136: read-path format guard. The I-132 incident chain ended with a 6-char
// garbage token from credentials.json reaching the Telegram API as
// `bot<garbage>/sendMessage` -> 404. In PG-secrets mode resolve* must skip
// corrupt pg/file values; env stays an unvalidated explicit override, and
// file-ONLY mode keeps the documented lenient file API (Arch-7 note).

function withPgSecretsEnv(fn: () => void): void {
  const prevUrl = process.env.IRIDA_DATABASE_URL;
  const prevKey = process.env.IRIDA_SECRETS_KEY;
  // pgSecretsEnabled() checks presence only; resolve* never dials PG here
  // (the cache is cold), so a dummy DSN is safe.
  process.env.IRIDA_DATABASE_URL = "postgresql://guard-test:x@127.0.0.1:1/na";
  process.env.IRIDA_SECRETS_KEY = "guard-test-secrets-key-32chars-long";
  try {
    fn();
  } finally {
    if (prevUrl === undefined) delete process.env.IRIDA_DATABASE_URL;
    else process.env.IRIDA_DATABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.IRIDA_SECRETS_KEY;
    else process.env.IRIDA_SECRETS_KEY = prevKey;
  }
}

function dirWithCredentials(fields: Record<string, string>): string {
  const dir = mkdtempSync(resolve(tmpdir(), "cred-guard-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, ".agent", "credentials.json"),
    JSON.stringify({ version: 1, ...fields }, null, 2) + "\n",
    "utf8"
  );
  return dir;
}

function withoutEnv(names: string[], fn: () => void): void {
  const prev = names.map((n) => [n, process.env[n]] as const);
  for (const n of names) delete process.env[n];
  try {
    fn();
  } finally {
    for (const [n, v] of prev) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
}

test("resolveTelegramBotToken skips a corrupt file token in pg mode (I-132 garbage class)", () => {
  const dir = dirWithCredentials({ telegram_bot_token: "abc123" }); // 6-char blob
  withoutEnv(["TELEGRAM_BOT_TOKEN"], () => {
    withPgSecretsEnv(() => {
      const out = resolveTelegramBotToken(dir);
      assert.equal(out.value, "");
      assert.equal(out.source, "none");
    });
  });
});

test("resolveTelegramBotToken stays lenient in file-only mode (Arch-7 contract)", () => {
  const dir = dirWithCredentials({ telegram_bot_token: "abc123" });
  withoutEnv(["TELEGRAM_BOT_TOKEN", "IRIDA_DATABASE_URL", "CSAGENT_DATABASE_URL"], () => {
    const out = resolveTelegramBotToken(dir);
    assert.equal(out.value, "abc123");
    assert.equal(out.source, "file");
  });
});

test("resolveTelegramBotToken returns a well-formed file token in pg mode", () => {
  const token = "123456789:AAFakeButWellFormedTokenValue_abc-XYZ";
  const dir = dirWithCredentials({ telegram_bot_token: token });
  withoutEnv(["TELEGRAM_BOT_TOKEN"], () => {
    withPgSecretsEnv(() => {
      const out = resolveTelegramBotToken(dir);
      assert.equal(out.value, token);
      assert.equal(out.source, "file");
    });
  });
});

test("resolveTelegramBotToken does not validate the env override", () => {
  const dir = dirWithCredentials({});
  const prev = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test-token"; // short, but explicit user env
  try {
    const out = resolveTelegramBotToken(dir);
    assert.equal(out.value, "test-token");
    assert.equal(out.source, "env");
  } finally {
    if (prev === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prev;
  }
});

test("resolveApiKey skips a corrupt file key in pg mode", () => {
  const dir = dirWithCredentials({ cursor_api_key: "garbage10c" }); // 10-char blob
  withoutEnv(["CURSOR_API_KEY"], () => {
    withPgSecretsEnv(() => {
      const out = resolveApiKey(dir);
      assert.equal(out.key, "");
      assert.equal(out.source, "none");
    });
  });
});

test("resolveApiKey returns a well-formed file key in pg mode", () => {
  const key = "key_0123456789abcdef0123456789abcdef0123456789abcdef";
  const dir = dirWithCredentials({ cursor_api_key: key });
  withoutEnv(["CURSOR_API_KEY"], () => {
    withPgSecretsEnv(() => {
      const out = resolveApiKey(dir);
      assert.equal(out.key, key);
      assert.equal(out.source, "file");
    });
  });
});
