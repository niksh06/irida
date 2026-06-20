import { test } from "node:test";
import assert from "node:assert/strict";
import {
  csagentHome,
  csagentRoot,
  csagentMemoryDir,
  csagentStateDir,
  csagentKbRoot,
  dualEnv,
  iridaHome,
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

test("rename shim: IRIDA_* preferred, legacy CSAGENT_* fallback", () => {
  const prevI = process.env.IRIDA_HOME;
  const prevC = process.env.CSAGENT_HOME;
  try {
    delete process.env.IRIDA_HOME;
    delete process.env.CSAGENT_HOME;
    assert.equal(iridaHome(), undefined);
    assert.equal(dualEnv("HOME"), undefined);

    process.env.CSAGENT_HOME = "/legacy"; // legacy still works
    assert.equal(iridaHome(), "/legacy");
    assert.equal(csagentHome(), "/legacy"); // alias agrees

    process.env.IRIDA_HOME = "/new"; // new prefix wins
    assert.equal(iridaHome(), "/new");
    assert.equal(dualEnv("HOME"), "/new");
  } finally {
    if (prevI === undefined) delete process.env.IRIDA_HOME;
    else process.env.IRIDA_HOME = prevI;
    if (prevC === undefined) delete process.env.CSAGENT_HOME;
    else process.env.CSAGENT_HOME = prevC;
  }
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
