import { test } from "node:test";
import assert from "node:assert/strict";
import { isDestructive, safetyGate } from "../src/safety.js";

test("detects destructive prompts", () => {
  assert.equal(isDestructive("please rm -rf /tmp/foo"), true);
  assert.equal(isDestructive("drop table users"), true);
  assert.equal(isDestructive("git push --force origin main"), true);
  assert.equal(isDestructive("summarize this repository"), false);
});

test("allowed prompt passes", async () => {
  const d = await safetyGate({ prompt: "list files", interactive: false });
  assert.equal(d.allowed, true);
  assert.equal(d.destructive, false);
});

test("destructive denied when non-interactive", async () => {
  const d = await safetyGate({ prompt: "rm -rf /", interactive: false });
  assert.equal(d.allowed, false);
  assert.equal(d.destructive, true);
});

test("destructive confirmed interactively", async () => {
  const d = await safetyGate({ prompt: "rm -rf build", interactive: true, confirm: async () => true });
  assert.equal(d.allowed, true);
});

test("destructive declined interactively", async () => {
  const d = await safetyGate({ prompt: "rm -rf build", interactive: true, confirm: async () => false });
  assert.equal(d.allowed, false);
});
