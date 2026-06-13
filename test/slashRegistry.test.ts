import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SLASH_REGISTRY,
  slashEntriesForSurface,
  slashRegistryHasCommand,
  tuiSlashCommands,
  gatewaySlashCommands,
  telegramBotCommandsFromRegistry,
} from "../src/slashRegistry.js";
import { SLASH_COMMANDS } from "../src/tui/slashCatalog.js";
import { GATEWAY_SLASH_COMMANDS } from "../src/gatewaySlash.js";

test("TUI and gateway catalogs derive from SLASH_REGISTRY", () => {
  assert.equal(SLASH_COMMANDS.length, slashEntriesForSurface("tui").length);
  assert.equal(GATEWAY_SLASH_COMMANDS.length, slashEntriesForSurface("gateway").length);
  assert.equal(tuiSlashCommands().length, SLASH_COMMANDS.length);
  assert.equal(gatewaySlashCommands().length, GATEWAY_SLASH_COMMANDS.length);
});

test("shared commands appear on both surfaces", () => {
  const shared = SLASH_REGISTRY.filter(
    (e) => e.surfaces.includes("tui") && e.surfaces.includes("gateway")
  ).map((e) => e.cmd);
  assert.ok(shared.includes("help"));
  assert.ok(shared.includes("delegate"));
  assert.ok(shared.includes("memory"));
});

test("surface-specific commands stay isolated", () => {
  assert.equal(slashRegistryHasCommand("find", "tui"), true);
  assert.equal(slashRegistryHasCommand("find", "gateway"), false);
  assert.equal(slashRegistryHasCommand("schedule", "gateway"), true);
  assert.equal(slashRegistryHasCommand("schedule", "tui"), false);
  assert.equal(slashRegistryHasCommand("mem", "gateway"), true);
});

test("telegram menu matches gateway telegram-enabled rows", () => {
  const menu = telegramBotCommandsFromRegistry();
  assert.equal(
    menu.length,
    gatewaySlashCommands().filter((c) => c.telegram !== false).length
  );
});
