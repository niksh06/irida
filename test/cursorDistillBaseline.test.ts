import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  archiveIsDelta,
  cursorDistillBaselinePath,
  loadCursorDistillBaseline,
  saveCursorDistillBaseline,
} from "../src/cursorDistillBaseline.js";

test("archiveIsDelta compares updated_at to baseline", () => {
  const baseline = { baselineAt: "2026-06-14T12:00:00.000Z" };
  assert.equal(archiveIsDelta("2026-06-15T00:00:00.000Z", baseline), true);
  assert.equal(archiveIsDelta("2026-06-14T12:00:00.000Z", baseline), false);
  assert.equal(archiveIsDelta("2026-06-01T00:00:00.000Z", undefined), true);
});

test("saveCursorDistillBaseline persists under stateDir", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "distill-baseline-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ model: "m", runtime: "local", cwd: dir, stateDir: ".agent" }),
    "utf8"
  );
  const saved = saveCursorDistillBaseline(dir, "2026-06-14T18:00:00.000Z", "backfill complete");
  assert.equal(saved.note, "backfill complete");
  assert.equal(loadCursorDistillBaseline(dir)?.baselineAt, "2026-06-14T18:00:00.000Z");
  const raw = JSON.parse(readFileSync(cursorDistillBaselinePath(dir), "utf8")) as { baselineAt: string };
  assert.equal(raw.baselineAt, "2026-06-14T18:00:00.000Z");
});
