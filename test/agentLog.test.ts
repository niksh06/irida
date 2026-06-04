import { test } from "node:test";
import assert from "node:assert/strict";
import { agentLogEnabled, agentLogVerbose, resolveAgentLogger } from "../src/agentLog.js";

test("agentLogEnabled respects CSAGENT_LOG", () => {
  const prev = process.env.CSAGENT_LOG;
  delete process.env.CSAGENT_DEBUG;
  process.env.CSAGENT_LOG = "1";
  assert.equal(agentLogEnabled(), true);
  process.env.CSAGENT_LOG = "0";
  assert.equal(agentLogEnabled(), false);
  if (prev === undefined) delete process.env.CSAGENT_LOG;
  else process.env.CSAGENT_LOG = prev;
});

test("agentLogVerbose respects CSAGENT_LOG_VERBOSE", () => {
  const prev = process.env.CSAGENT_LOG_VERBOSE;
  process.env.CSAGENT_LOG_VERBOSE = "yes";
  assert.equal(agentLogVerbose(), true);
  if (prev === undefined) delete process.env.CSAGENT_LOG_VERBOSE;
  else process.env.CSAGENT_LOG_VERBOSE = prev;
});

test("resolveAgentLogger forwards to onLog when CSAGENT_LOG off", () => {
  const prev = process.env.CSAGENT_LOG;
  delete process.env.CSAGENT_LOG;
  delete process.env.CSAGENT_DEBUG;
  const lines: string[] = [];
  const log = resolveAgentLogger({ component: "test", onLog: (l) => lines.push(l) });
  log("[chat] hello");
  assert.deepEqual(lines, ["[chat] hello"]);
  if (prev === undefined) delete process.env.CSAGENT_LOG;
  else process.env.CSAGENT_LOG = prev;
});
