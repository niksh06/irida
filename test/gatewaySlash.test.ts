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
