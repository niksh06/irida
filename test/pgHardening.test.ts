import { test } from "node:test";
import assert from "node:assert/strict";
import { redact } from "../src/redact.js";
import { setPgCredentialSecret } from "../src/credentialsPg.js";
import { PostgresMemoryStore } from "../src/memoryStore.js";
import { makeEmbedder } from "../src/embeddings.js";

// I-142 (audit H-13, part 2): small PG-layer hardening quartet.

test("redact masks Anthropic sk-ant keys and generic sk- keys", () => {
  const out = redact("key sk-ant-api03-abcdefghijklmnop leaked, also sk-1234567890abcdefghij");
  assert.ok(!out.includes("sk-ant-api03"), out);
  assert.ok(!out.includes("sk-1234567890abcdefghij"), out);
  assert.match(out, /<redacted>/);
  // Short non-secret "sk-" fragments stay readable.
  assert.equal(redact("risk-based approach"), "risk-based approach");
});

test("setPgCredentialSecret refuses a weak IRIDA_SECRETS_KEY (enforce on write)", async () => {
  const prevUrl = process.env.IRIDA_DATABASE_URL;
  const prevKey = process.env.IRIDA_SECRETS_KEY;
  process.env.IRIDA_DATABASE_URL = "postgresql://x:x@127.0.0.1:1/na"; // never dialed — check throws first
  process.env.IRIDA_SECRETS_KEY = "short-key";
  try {
    await assert.rejects(
      setPgCredentialSecret("telegram_bot_token", "123456789:AAFakeButWellFormedTokenValue_abc-XYZ"),
      /weak key/
    );
  } finally {
    if (prevUrl === undefined) delete process.env.IRIDA_DATABASE_URL;
    else process.env.IRIDA_DATABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.IRIDA_SECRETS_KEY;
    else process.env.IRIDA_SECRETS_KEY = prevKey;
  }
});

test("PostgresMemoryStore.close is double-release safe (ref-counted pools)", async () => {
  const store = new PostgresMemoryStore("postgresql://x:x@127.0.0.1:1/na");
  await store.close();
  await store.close(); // second close must not decrement another holder's ref
});

test("embedder requests carry an abort signal (wedged service cannot hang saves)", async () => {
  let sawSignal = false;
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    sawSignal = init?.signal instanceof AbortSignal;
    return new Response(JSON.stringify({ vector: Array(768).fill(0.1) }));
  }) as typeof fetch;
  const embed = makeEmbedder({ enabled: true, provider: "embed-service", url: "http://127.0.0.1:9" }, fetchFn);
  assert.ok(embed);
  const vec = await embed!("hello");
  assert.equal(sawSignal, true);
  assert.equal(vec?.length, 768);
});
