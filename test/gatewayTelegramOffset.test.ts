import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadTelegramPollOffset,
  saveTelegramPollOffset,
  gatewayTelegramOffsetPath,
} from "../src/gatewayTelegramOffset.js";

test("telegram poll offset persists across restarts", () => {
  const dir = mkdtempSync(join(tmpdir(), "tg-offset-"));
  assert.equal(loadTelegramPollOffset(dir), 0);
  saveTelegramPollOffset(dir, 814156445);
  assert.equal(loadTelegramPollOffset(dir), 814156445);
  assert.ok(existsSync(gatewayTelegramOffsetPath(dir)));
  assert.equal(readFileSync(gatewayTelegramOffsetPath(dir), "utf8"), "814156445");
});
