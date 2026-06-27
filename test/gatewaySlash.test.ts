import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gatewaySlashHelpText,
  gatewayTelegramBotCommands,
  parseGatewaySlash,
  isGatewaySlashCommand,
  GATEWAY_SLASH_COMMANDS,
} from "../src/gatewaySlash.js";

test("gatewaySlashHelpText is irida branded", () => {
  const help = gatewaySlashHelpText();
  assert.match(help, /irida/);
  assert.match(help, /\/help/);
  assert.match(help, /\/doctor/);
  assert.match(help, /\/delegate/);
  assert.doesNotMatch(help, /hermes/i);
});

test("parseGatewaySlash splits cmd and arg", () => {
  assert.deepEqual(parseGatewaySlash("/memory kafka"), { cmd: "memory", arg: "kafka" });
  assert.deepEqual(parseGatewaySlash("/approve ABC123"), { cmd: "approve", arg: "ABC123" });
  assert.deepEqual(parseGatewaySlash("/status@HelperSummaryBot"), { cmd: "status", arg: "" });
  assert.equal(parseGatewaySlash("hello"), null);
});

test("isGatewaySlashCommand recognizes Telegram @BotUsername suffix", () => {
  assert.equal(isGatewaySlashCommand("/status@HelperSummaryBot"), true);
});

test("gatewayTelegramBotCommands matches slash catalog size", () => {
  const cmds = gatewayTelegramBotCommands();
  assert.equal(cmds.length, GATEWAY_SLASH_COMMANDS.filter((c) => c.telegram !== false).length);
  assert.ok(cmds.every((c) => /^[a-z0-9_]{1,32}$/.test(c.command)));
  assert.ok(cmds.some((c) => c.command === "help" && c.description.includes("irida")));
});

test("isGatewaySlashCommand recognizes catalog + /mem alias", () => {
  for (const c of GATEWAY_SLASH_COMMANDS) {
    assert.equal(isGatewaySlashCommand(`/${c.cmd}`), true);
  }
  assert.equal(isGatewaySlashCommand("/mem list"), true);
  assert.equal(isGatewaySlashCommand("/unknown"), false);
});

import { handleGatewaySlash, type GatewaySlashContext } from "../src/gatewaySlash.js";
import type { GatewayConfig } from "../src/gatewayConfig.js";
import { applyAgentSkill } from "../src/skillApply.js";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve as r2, join as j2 } from "node:path";

function slashSandbox(): { dir: string; ctx: GatewaySlashContext; restore: () => void } {
  const dir = mkdtempSync(r2(tmpdir(), "gw-prop-"));
  mkdirSync(j2(dir, "skills"), { recursive: true });
  writeFileSync(j2(dir, "agent.config.json"), JSON.stringify({ stateDir: ".agent" }) + "\n");
  const prev = { H: process.env.IRIDA_HOME, R: process.env.IRIDA_ROOT };
  process.env.IRIDA_HOME = dir;
  process.env.IRIDA_ROOT = dir;
  const ctx: GatewaySlashContext = {
    dir,
    adapter: "test",
    chatId: "c1",
    cfg: {} as unknown as GatewayConfig,
    skills: [],
  };
  return {
    dir,
    ctx,
    restore: () => {
      prev.H === undefined ? delete process.env.IRIDA_HOME : (process.env.IRIDA_HOME = prev.H);
      prev.R === undefined ? delete process.env.IRIDA_ROOT : (process.env.IRIDA_ROOT = prev.R);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const GOOD_SKILL = "---\nname: retry-flaky\ndescription: bounded retry\n---\nUse a bounded retry with backoff.";

test("/proposals surfaces auto-applied skills with fitness + undo hint", async () => {
  const sb = slashSandbox();
  try {
    applyAgentSkill(sb.dir, "skills", "retry-flaky", GOOD_SKILL, { evalScore: 0.5 });
    const out = await handleGatewaySlash("/proposals", sb.ctx);
    assert.match(out!, /auto-applied skills/);
    assert.match(out!, /retry-flaky/);
    assert.match(out!, /fitness 0\.50/);
    assert.match(out!, /rollback <skill>/);
  } finally {
    sb.restore();
  }
});

test("/proposals rollback <skill> undoes an auto-applied skill", async () => {
  const sb = slashSandbox();
  try {
    applyAgentSkill(sb.dir, "skills", "retry-flaky", GOOD_SKILL, { evalScore: 0.5 });
    assert.ok(existsSync(j2(sb.dir, "skills", "agent", "retry-flaky.md")));
    const out = await handleGatewaySlash("/proposals rollback retry-flaky", sb.ctx);
    assert.match(out!, /rolled back skill "retry-flaky"/);
    assert.equal(existsSync(j2(sb.dir, "skills", "agent", "retry-flaky.md")), false, "skill file removed");
  } finally {
    sb.restore();
  }
});

test("/proposals with nothing pending or applied says so", async () => {
  const sb = slashSandbox();
  try {
    const out = await handleGatewaySlash("/proposals", sb.ctx);
    assert.match(out!, /no pending proposals or auto-applied skills/);
  } finally {
    sb.restore();
  }
});

test("/mode sets, shows, and clears a sticky per-chat mode (I-91)", async () => {
  const sb = slashSandbox();
  try {
    assert.match((await handleGatewaySlash("/mode", sb.ctx))!, /mode: none/);
    assert.match((await handleGatewaySlash("/mode do", sb.ctx))!, /mode → \*\*do\*\*/);
    assert.match((await handleGatewaySlash("/mode", sb.ctx))!, /mode: \*\*do\*\*/);
    assert.match((await handleGatewaySlash("/mode bogus", sb.ctx))!, /unknown mode/);
    assert.match((await handleGatewaySlash("/mode off", sb.ctx))!, /mode cleared/);
    assert.match((await handleGatewaySlash("/mode", sb.ctx))!, /mode: none/);
  } finally {
    sb.restore();
  }
});
