import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateCursorApiKeyFormat,
  validateTelegramBotTokenFormat,
} from "../src/credentials.js";
import { parseOlderThanDays } from "../src/memoryFactPrune.js";

test("validateCursorApiKeyFormat rejects short garbage", () => {
  const r = validateCursorApiKeyFormat("abc123");
  assert.equal(r.ok, false);
  assert.match(r.detail, /too short/);
});

test("validateCursorApiKeyFormat accepts crsr_ prefix", () => {
  assert.ok(validateCursorApiKeyFormat("crsr_" + "x".repeat(20)).ok);
});

test("validateTelegramBotTokenFormat accepts typical bot token shape", () => {
  const token = "1234567890:" + "A".repeat(35);
  const r = validateTelegramBotTokenFormat(token);
  assert.ok(r.ok);
  assert.ok(token.length >= 40);
});

test("validateTelegramBotTokenFormat rejects 6-char PG garbage", () => {
  const r = validateTelegramBotTokenFormat("garbage");
  assert.equal(r.ok, false);
});

test("parseOlderThanDays", () => {
  assert.equal(parseOlderThanDays("30d"), 30);
  assert.equal(parseOlderThanDays("7D"), 7);
  assert.equal(parseOlderThanDays("30"), null);
});
