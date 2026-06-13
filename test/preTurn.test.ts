import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { saveMemory } from "../src/memory.js";
import { composePrompt } from "../src/composePrompt.js";
import { createMemoryStore } from "../src/memoryStore.js";
import {
  buildPreTurnBlocks,
  formatModeBlock,
  parseTurnMode,
  preTurnProfileBlock,
} from "../src/preTurn.js";

test("parseTurnMode strips ADVICE prefix", () => {
  const { taskText, mode } = parseTurnMode("ADVICE: проверь X");
  assert.equal(mode, "advice");
  assert.equal(taskText, "проверь X");
});

test("parseTurnMode is case-insensitive", () => {
  const { taskText, mode } = parseTurnMode("do: ship it");
  assert.equal(mode, "do");
  assert.equal(taskText, "ship it");
});

test("parseTurnMode env fallback when preTurn configured", () => {
  const prev = process.env.CSAGENT_MODE;
  process.env.CSAGENT_MODE = "DEBUG";
  try {
    const { taskText, mode } = parseTurnMode("check logs", { envFallback: true });
    assert.equal(mode, "debug");
    assert.equal(taskText, "check logs");
  } finally {
    if (prev === undefined) delete process.env.CSAGENT_MODE;
    else process.env.CSAGENT_MODE = prev;
  }
});

test("parseTurnMode no env fallback without preTurn config", () => {
  const prev = process.env.CSAGENT_MODE;
  process.env.CSAGENT_MODE = "DO";
  try {
    const { mode } = parseTurnMode("check logs");
    assert.equal(mode, undefined);
  } finally {
    if (prev === undefined) delete process.env.CSAGENT_MODE;
    else process.env.CSAGENT_MODE = prev;
  }
});

test("preTurnProfileBlock fail-soft when note missing", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "preturn-miss-"));
  writeFileSync(
    resolve(dir, "agent.config.json"),
    JSON.stringify({
      memory: { preTurn: { profileNote: "user-profile.niksh" } },
    })
  );
  const cfg = loadConfig(dir);
  const block = await preTurnProfileBlock(dir, cfg);
  assert.equal(block, undefined);
});

test("preTurnProfileBlock loads note excerpt", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "preturn-hit-"));
  writeFileSync(
    resolve(dir, "agent.config.json"),
    JSON.stringify({
      memory: { preTurn: { profileNote: "user-profile.niksh", profileMaxChars: 256 } },
    })
  );
  const cfg = loadConfig(dir);
  const store = createMemoryStore(dir, cfg.stateDir);
  try {
    await store.upsertNote({
      name: "user-profile.niksh",
      body: "UNIQUE_PROFILE_SNIPPET_98765 ".repeat(200),
    });
  } finally {
    await store.close();
  }
  const block = await preTurnProfileBlock(dir, cfg);
  assert.match(block ?? "", /UNIQUE_PROFILE_SNIPPET_98765/);
  assert.ok((block ?? "").length <= 320);
});

test("composePrompt orders profile + mode before autoRag and task", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "preturn-compose-"));
  writeFileSync(
    resolve(dir, "agent.config.json"),
    JSON.stringify({
      memory: {
        preTurn: { profileNote: "user-profile.niksh" },
      },
    })
  );
  const cfg = loadConfig(dir);
  const store = createMemoryStore(dir, cfg.stateDir);
  try {
    await store.upsertNote({ name: "user-profile.niksh", body: "Prefer short answers and cite evidence" });
  } finally {
    await store.close();
  }

  const { taskText, blocks: preTurnBlocks } = await buildPreTurnBlocks({
    dir,
    cfg,
    rawMessage: "ADVICE: проверь gateway outbox",
    includeProfile: true,
  });
  assert.equal(taskText, "проверь gateway outbox");
  assert.equal(preTurnBlocks.length, 2);

  const autoRagBlocks = ["### Memory: ops\n\nGateway outbox drains every poll"];

  const composed = await composePrompt({
    userPrompt: taskText,
    cwd: dir,
    dir,
    preTurnBlocks,
    autoRagBlocks,
  });

  const modeIdx = composed.indexOf(formatModeBlock("advice"));
  const profileIdx = composed.indexOf("User profile excerpt");
  const autoRagIdx = composed.indexOf("Relevant memory (retrieved for this message)");
  const taskIdx = composed.indexOf("# Task");
  const taskBodyIdx = composed.indexOf("проверь gateway outbox");

  assert.ok(modeIdx >= 0);
  assert.ok(profileIdx > modeIdx);
  assert.ok(autoRagIdx > profileIdx);
  assert.ok(taskIdx > autoRagIdx);
  assert.ok(taskBodyIdx > taskIdx);
  assert.doesNotMatch(composed, /ADVICE:/);
});
