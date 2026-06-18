import { test } from "node:test";
import assert from "node:assert/strict";
import { csagentHome } from "../src/env.js";

function withHome<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.CSAGENT_HOME;
  if (value === undefined) delete process.env.CSAGENT_HOME;
  else process.env.CSAGENT_HOME = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CSAGENT_HOME;
    else process.env.CSAGENT_HOME = prev;
  }
}

test("csagentHome trims and normalizes unset/empty to undefined", () => {
  assert.equal(withHome(undefined, csagentHome), undefined);
  assert.equal(withHome("", csagentHome), undefined);
  assert.equal(withHome("   ", csagentHome), undefined);
  assert.equal(withHome("/Users/x/.csagent", csagentHome), "/Users/x/.csagent");
  assert.equal(withHome("  /trim/me  ", csagentHome), "/trim/me");
});
