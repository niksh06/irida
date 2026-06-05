import { test } from "node:test";
import assert from "node:assert/strict";
import { pgSecretsEnabled, secretsKey, SECRETS_KEY_ENV } from "../src/credentialsPg.js";

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
