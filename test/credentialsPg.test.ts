import { test } from "node:test";
import assert from "node:assert/strict";
import {
  closePgCredentialPool,
  listPgCredentialHistory,
  pgSecretsEnabled,
  readPgCredentialHistoryValue,
  secretsKey,
  setPgCredentialSecret,
  SECRETS_KEY_ENV,
} from "../src/credentialsPg.js";

const PG_URL = process.env.CSAGENT_TEST_PG_URL?.trim();

function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void | Promise<void>
): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

test("pgSecretsEnabled requires database url and secrets key", async () => {
  await withEnv(
    { CSAGENT_DATABASE_URL: undefined, [SECRETS_KEY_ENV]: undefined },
    () => {
      assert.equal(pgSecretsEnabled(), false);
    }
  );
  await withEnv(
    { CSAGENT_DATABASE_URL: "postgresql://x", [SECRETS_KEY_ENV]: undefined },
    () => {
      assert.equal(pgSecretsEnabled(), false);
    }
  );
  await withEnv(
    { CSAGENT_DATABASE_URL: undefined, [SECRETS_KEY_ENV]: "key" },
    () => {
      assert.equal(pgSecretsEnabled(), false);
    }
  );
  await withEnv(
    { CSAGENT_DATABASE_URL: "postgresql://x", [SECRETS_KEY_ENV]: "key" },
    () => {
      assert.equal(pgSecretsEnabled(), true);
      assert.equal(secretsKey(), "key");
    }
  );
});

test(
  "secret overwrite archives previous version; restore round-trips (postmortem fix)",
  { skip: !PG_URL ? "set CSAGENT_TEST_PG_URL to run" : false },
  async () => {
    await withEnv(
      { CSAGENT_DATABASE_URL: PG_URL, [SECRETS_KEY_ENV]: "history-test-key" },
      async () => {
        const v1 = "1234567890:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        const v2 = "1234567890:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
        try {
          await setPgCredentialSecret("telegram_bot_token", v1);
          await setPgCredentialSecret("telegram_bot_token", v2);
          const history = await listPgCredentialHistory(() => true);
          const archived = history.find((e) => e.name === "telegram_bot_token");
          assert.ok(archived, "previous version must be archived on overwrite");
          assert.equal(archived!.valueLength, v1.length);
          const restored = await readPgCredentialHistoryValue(archived!.id);
          assert.equal(restored?.value, v1);
        } finally {
          await closePgCredentialPool();
        }
      }
    );
  }
);
