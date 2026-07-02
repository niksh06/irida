import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  resolveAnthropicKey,
  resolveClaudeOAuthToken,
  validateAnthropicApiKeyFormat,
  validateClaudeOAuthTokenFormat,
} from "../src/credentials.js";
import { handleGatewaySlash } from "../src/gatewaySlash.js";
import type { GatewayConfig } from "../src/gatewayConfig.js";

// I-145: anthropic_api_key / claude_code_oauth_token join the pgcrypto
// credential store — same env → pg → file precedence as cursor/telegram, so
// /engine claude works when the key is stored "like the telegram token".

const FAKE_ANTHROPIC_KEY = "sk-ant-api03-FAKE-test-key-abcdefghijklmnopqrstuvwxyz012345";

function dirWithCredentials(fields: Record<string, string>): string {
  const dir = mkdtempSync(resolve(tmpdir(), "anthropic-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, ".agent", "credentials.json"),
    JSON.stringify({ version: 1, ...fields }, null, 2) + "\n",
    "utf8"
  );
  return dir;
}

function withoutEnv<T>(names: string[], fn: () => Promise<T>): Promise<T> {
  const prev = names.map((n) => [n, process.env[n]] as const);
  for (const n of names) delete process.env[n];
  return fn().finally(() => {
    for (const [n, v] of prev) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  });
}

test("anthropic/oauth format validators", () => {
  assert.equal(validateAnthropicApiKeyFormat(FAKE_ANTHROPIC_KEY).ok, true);
  assert.equal(validateAnthropicApiKeyFormat("abc123").ok, false); // corruption floor
  assert.equal(validateAnthropicApiKeyFormat("x".repeat(45)).ok, true); // long non-prefixed
  assert.equal(validateClaudeOAuthTokenFormat("sk-ant-oat01-" + "y".repeat(40)).ok, true);
  assert.equal(validateClaudeOAuthTokenFormat("short").ok, false);
});

test("resolveAnthropicKey: env → file precedence, file value served", async () => {
  await withoutEnv(["ANTHROPIC_API_KEY"], async () => {
    const dir = dirWithCredentials({ anthropic_api_key: FAKE_ANTHROPIC_KEY });
    const out = resolveAnthropicKey(dir);
    assert.equal(out.key, FAKE_ANTHROPIC_KEY);
    assert.equal(out.source, "file");
  });
  const dir = dirWithCredentials({ anthropic_api_key: FAKE_ANTHROPIC_KEY });
  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-ant-env-override-abcdefghijklmnopqrstuv";
  try {
    assert.equal(resolveAnthropicKey(dir).source, "env");
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
  }
});

test("resolveAnthropicKey skips a corrupt file key in pg mode (guard parity)", async () => {
  await withoutEnv(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"], async () => {
    const dir = dirWithCredentials({ anthropic_api_key: "garbage" });
    const prevUrl = process.env.IRIDA_DATABASE_URL;
    const prevKey = process.env.IRIDA_SECRETS_KEY;
    process.env.IRIDA_DATABASE_URL = "postgresql://guard:x@127.0.0.1:1/na";
    process.env.IRIDA_SECRETS_KEY = "guard-test-secrets-key-32chars-long";
    try {
      const out = resolveAnthropicKey(dir);
      assert.equal(out.source, "none");
    } finally {
      if (prevUrl === undefined) delete process.env.IRIDA_DATABASE_URL;
      else process.env.IRIDA_DATABASE_URL = prevUrl;
      if (prevKey === undefined) delete process.env.IRIDA_SECRETS_KEY;
      else process.env.IRIDA_SECRETS_KEY = prevKey;
    }
  });
});

test("resolveClaudeOAuthToken reads the file when env is absent", async () => {
  await withoutEnv(["CLAUDE_CODE_OAUTH_TOKEN"], async () => {
    const dir = dirWithCredentials({ claude_code_oauth_token: "sk-ant-oat01-" + "z".repeat(40) });
    const out = resolveClaudeOAuthToken(dir);
    assert.equal(out.source, "file");
  });
});

test("/engine claude passes the pre-check with a stored anthropic key (api-key auth)", async () => {
  await withoutEnv(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"], async () => {
    const dir = dirWithCredentials({ anthropic_api_key: FAKE_ANTHROPIC_KEY });
    const resets: string[] = [];
    const reply = await handleGatewaySlash("/engine claude", {
      dir,
      adapter: "telegram",
      chatId: "42",
      cfg: {} as GatewayConfig,
      skills: [],
      resetSession: async () => {
        resets.push("reset");
        return null;
      },
    });
    assert.match(reply!, /движок → \*\*claude-agent\*\*/);
    assert.deepEqual(resets, ["reset"]);
  });
});

test("PG roundtrip: persist → warm → resolve from postgres; file copy stripped, others preserved", { skip: !(process.env.IRIDA_TEST_PG_URL ?? process.env.CSAGENT_TEST_PG_URL) ? "IRIDA_TEST_PG_URL not set" : false }, async () => {
  const testUrl = process.env.IRIDA_TEST_PG_URL ?? process.env.CSAGENT_TEST_PG_URL!;
  const prev: Array<[string, string | undefined]> = [
    ["IRIDA_DATABASE_URL", process.env.IRIDA_DATABASE_URL],
    ["IRIDA_SECRETS_KEY", process.env.IRIDA_SECRETS_KEY],
    ["ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY],
  ];
  process.env.IRIDA_DATABASE_URL = testUrl;
  process.env.IRIDA_SECRETS_KEY = "integration-test-secrets-key-32chars-long";
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const { persistAnthropicApiKey, warmCredentialsCache } = await import("../src/credentials.js");
    const { clearPgCredentialSecrets } = await import("../src/credentialsPg.js");
    await clearPgCredentialSecrets();
    // File starts with BOTH an anthropic key and an unrelated telegram token.
    const dir = dirWithCredentials({
      anthropic_api_key: FAKE_ANTHROPIC_KEY,
      telegram_bot_token: "123456789:AAFakeButWellFormedTokenValue_abc-XYZ",
    });
    await persistAnthropicApiKey(FAKE_ANTHROPIC_KEY, dir);
    // Plaintext copy of the persisted secret is stripped; the OTHER field survives (strip fix).
    const file = JSON.parse(readFileSync(join(dir, ".agent", "credentials.json"), "utf8"));
    assert.equal(file.anthropic_api_key, undefined);
    assert.equal(typeof file.telegram_bot_token, "string");
    await warmCredentialsCache(dir);
    const out = resolveAnthropicKey(dir);
    assert.equal(out.source, "pg");
    assert.equal(out.key, FAKE_ANTHROPIC_KEY);
    await clearPgCredentialSecrets();
  } finally {
    for (const [n, v] of prev) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
});
