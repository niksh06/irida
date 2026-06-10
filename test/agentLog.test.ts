import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
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

test("resolveAgentLogger writes to logFile instead of stdout (TUI, I-17)", () => {
  const prev = process.env.CSAGENT_LOG;
  process.env.CSAGENT_LOG = "1";
  const dir = mkdtempSync(resolve(tmpdir(), "tuilog-"));
  const logFile = resolve(dir, ".agent", "tui.log");
  const log = resolveAgentLogger({ component: "tui", logFile });
  log("[chat] rotate start reason=test");
  log("[chat] sendTurn failed boom");
  assert.ok(existsSync(logFile));
  const body = readFileSync(logFile, "utf8");
  assert.match(body, /\[tui\] .*rotate start/);
  assert.match(body, /^ERROR \[tui\] .*sendTurn failed/m);
  if (prev === undefined) delete process.env.CSAGENT_LOG;
  else process.env.CSAGENT_LOG = prev;
});
