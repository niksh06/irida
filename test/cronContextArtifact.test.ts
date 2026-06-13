import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  CRON_CONTEXT_MAX_BYTES,
  cronContextArtifactPath,
  loadCronContextArtifact,
  saveCronContextArtifact,
} from "../src/cronContextArtifact.js";
import { saveCronJobResult } from "../src/cronRunRecord.js";
import { EXIT } from "../src/exit.js";

function tmp(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "cron-ctx-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ stateDir: ".agent", cwd: dir }),
    "utf8"
  );
  return dir;
}

test("saveCronJobResult writes context artifact on OK run with output", () => {
  const dir = tmp();
  saveCronJobResult(
    dir,
    "digest",
    { ok: true, exitCode: EXIT.ok, message: "ok", output: "📬 digest body" },
    new Date("2026-06-13T12:00:00Z")
  );
  const path = cronContextArtifactPath(dir, "digest");
  assert.equal(existsSync(path), true);
  const artifact = loadCronContextArtifact(dir, "digest");
  assert.ok(artifact);
  assert.equal(artifact!.output, "📬 digest body");
  assert.equal(artifact!.format, "text");
  assert.equal(artifact!.jobId, "digest");
});

test("loadCronContextArtifact returns same body on second read", () => {
  const dir = tmp();
  saveCronContextArtifact(
    dir,
    "job-a",
    { ok: true, exitCode: EXIT.ok, message: "ok", output: '{"items":[1,2]}' },
    new Date("2026-06-13T12:00:00Z")
  );
  const first = loadCronContextArtifact(dir, "job-a");
  const second = loadCronContextArtifact(dir, "job-a");
  assert.deepEqual(first, second);
  assert.equal(first!.format, "json");
});

test("saveCronContextArtifact skips failed runs and silent script jobs", () => {
  const dir = tmp();
  saveCronContextArtifact(dir, "fail", { ok: false, exitCode: EXIT.software, message: "x", output: "nope" });
  saveCronContextArtifact(dir, "silent", { ok: true, exitCode: EXIT.ok, message: "ok", silent: true });
  assert.equal(existsSync(cronContextArtifactPath(dir, "fail")), false);
  assert.equal(existsSync(cronContextArtifactPath(dir, "silent")), false);
});

test("saveCronContextArtifact redacts secrets and truncates large output", () => {
  const dir = tmp();
  const secret = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef";
  const big = "x".repeat(CRON_CONTEXT_MAX_BYTES + 5000) + secret;
  saveCronContextArtifact(
    dir,
    "big",
    { ok: true, exitCode: EXIT.ok, message: "ok", output: big },
    new Date()
  );
  const artifact = loadCronContextArtifact(dir, "big");
  assert.ok(artifact);
  assert.equal(artifact!.truncated, true);
  assert.ok(!artifact!.output.includes(secret));
  assert.ok(Buffer.byteLength(artifact!.output, "utf8") <= CRON_CONTEXT_MAX_BYTES + 64);
});

test("saveCronContextArtifact is fail-soft when dir not writable", () => {
  const dir = tmp();
  const root = join(dir, ".agent", "cron.context");
  mkdirSync(root, { recursive: true });
  chmodSync(root, 0o500);
  assert.doesNotThrow(() =>
    saveCronContextArtifact(
      dir,
      "locked",
      { ok: true, exitCode: EXIT.ok, message: "ok", output: "hello" },
      new Date()
    )
  );
  chmodSync(root, 0o700);
});
