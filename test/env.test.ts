import { test } from "node:test";
import assert from "node:assert/strict";
import {
  csagentHome,
  csagentRoot,
  csagentMemoryDir,
  csagentStateDir,
  csagentKbRoot,
} from "../src/env.js";

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

function withVar<T>(name: string, value: string | undefined, fn: () => T): T {
  const prev = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
  }
}

test("path-root accessors trim and normalize empty to undefined", () => {
  for (const [name, fn] of [
    ["CSAGENT_ROOT", csagentRoot],
    ["CSAGENT_MEMORY_DIR", csagentMemoryDir],
    ["CSAGENT_STATE_DIR", csagentStateDir],
    ["CSAGENT_KB_ROOT", csagentKbRoot],
  ] as const) {
    assert.equal(withVar(name, undefined, fn), undefined, `${name} unset`);
    assert.equal(withVar(name, "  ", fn), undefined, `${name} blank`);
    assert.equal(withVar(name, "  /p  ", fn), "/p", `${name} trims`);
  }
});
