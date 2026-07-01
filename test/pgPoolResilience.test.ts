import { test } from "node:test";
import assert from "node:assert/strict";
import { isTransientPgError, withPgRetry } from "../src/pg/pool.js";

test("isTransientPgError recognizes connection-level codes and messages", () => {
  assert.equal(isTransientPgError(Object.assign(new Error("x"), { code: "ECONNREFUSED" })), true);
  assert.equal(isTransientPgError(Object.assign(new Error("x"), { code: "57P01" })), true);
  assert.equal(isTransientPgError(new Error("Connection terminated unexpectedly")), true);
  // Node multi-address connect (localhost v4+v6) surfaces as AggregateError.
  const agg = new AggregateError(
    [Object.assign(new Error("connect ECONNREFUSED ::1:5435"), { code: "ECONNREFUSED" })],
    ""
  );
  assert.equal(isTransientPgError(agg), true);
  // Non-transient: SQL/logic errors must NOT be retried.
  assert.equal(isTransientPgError(Object.assign(new Error("syntax error"), { code: "42601" })), false);
  assert.equal(isTransientPgError(new Error("duplicate key value violates unique constraint")), false);
  assert.equal(isTransientPgError(null), false);
});

test("withPgRetry retries transient failures and returns the eventual result", async () => {
  let calls = 0;
  const out = await withPgRetry(
    async () => {
      calls++;
      if (calls < 3) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      return "ok";
    },
    { attempts: 3, delayMs: 1 }
  );
  assert.equal(out, "ok");
  assert.equal(calls, 3);
});

test("withPgRetry gives up after the attempt budget", async () => {
  let calls = 0;
  await assert.rejects(
    withPgRetry(
      async () => {
        calls++;
        throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      },
      { attempts: 3, delayMs: 1 }
    ),
    /ECONNREFUSED/
  );
  assert.equal(calls, 3);
});

test("withPgRetry does not retry non-transient errors", async () => {
  let calls = 0;
  await assert.rejects(
    withPgRetry(
      async () => {
        calls++;
        throw Object.assign(new Error("syntax error at or near"), { code: "42601" });
      },
      { attempts: 3, delayMs: 1 }
    ),
    /syntax error/
  );
  assert.equal(calls, 1);
});
