import { test } from "node:test";
import assert from "node:assert/strict";
import { acquirePgPool, releasePgPool, pgConfigured, pgConnectionString, probePgReachable } from "../src/pg/pool.js";

test("pgConfigured / pgConnectionString reflect CSAGENT_DATABASE_URL", () => {
  const prev = process.env.CSAGENT_DATABASE_URL;
  try {
    delete process.env.CSAGENT_DATABASE_URL;
    assert.equal(pgConfigured(), false);
    assert.throws(() => pgConnectionString(), /not set/);
    process.env.CSAGENT_DATABASE_URL = "postgres://u@h/db";
    assert.equal(pgConfigured(), true);
    assert.equal(pgConnectionString(), "postgres://u@h/db");
  } finally {
    if (prev === undefined) delete process.env.CSAGENT_DATABASE_URL;
    else process.env.CSAGENT_DATABASE_URL = prev;
  }
});

test("acquirePgPool shares one pool per connection string, ref-counted", async () => {
  // Never connects (no query) — only exercises the registry bookkeeping.
  const cs = "postgres://u:p@127.0.0.1:1/ref-test";
  const a = acquirePgPool(cs);
  const b = acquirePgPool(cs);
  assert.strictEqual(a, b, "same connection string → same pool instance");
  await releasePgPool(cs); // one holder left → pool stays
  const c = acquirePgPool(cs);
  assert.strictEqual(c, a, "still the same pool while refs > 0");
  await releasePgPool(cs);
  await releasePgPool(cs); // last holder → pool ends
  const d = acquirePgPool(cs);
  assert.notStrictEqual(d, a, "after full release a fresh pool is created");
  await releasePgPool(cs);
});

test("probePgReachable: sqlite note without DATABASE_URL", async () => {
  const prev = process.env.CSAGENT_DATABASE_URL;
  try {
    delete process.env.CSAGENT_DATABASE_URL;
    const r = await probePgReachable(300);
    assert.equal(r.ok, true);
    assert.match(r.detail, /sqlite/);
  } finally {
    if (prev === undefined) delete process.env.CSAGENT_DATABASE_URL;
    else process.env.CSAGENT_DATABASE_URL = prev;
  }
});
