import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { acquireCronTickLock, CRON_TICK_LOCK_TTL_MS } from "../src/cronEngine.js";
import { executeCronJob } from "../src/cronEngine.js";

// I-140 (audit H-5): lock ownership (release must never delete another
// process's lock), stale-break, heartbeat, and the per-job-type API key gate.

function tmp(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "cron-lock-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  return dir;
}

const lockPathOf = (dir: string) => join(dir, ".agent", "cron.tick.lock");

test("release does not delete a lock owned by someone else", () => {
  const dir = tmp();
  const lock = acquireCronTickLock(dir);
  assert.ok(lock);
  // Another process breaks + re-creates the lock (TTL race).
  writeFileSync(lockPathOf(dir), "99999 other-nonce 2026-07-02T00:00:00Z\n", "utf8");
  lock!.release();
  assert.equal(existsSync(lockPathOf(dir)), true); // foreign lock survived
});

test("own lock is released; stale lock is broken and reacquired; live lock blocks", () => {
  const dir = tmp();
  const a = acquireCronTickLock(dir);
  assert.ok(a);
  assert.equal(acquireCronTickLock(dir), null); // held → blocked
  a!.release();
  assert.equal(existsSync(lockPathOf(dir)), false); // own release removes it

  // Stale lock (crashed holder): old mtime → broken and reacquired.
  writeFileSync(lockPathOf(dir), "99999 dead-nonce 2026-01-01T00:00:00Z\n", "utf8");
  const old = new Date(Date.now() - CRON_TICK_LOCK_TTL_MS - 60_000);
  utimesSync(lockPathOf(dir), old, old);
  const b = acquireCronTickLock(dir);
  assert.ok(b);
  assert.ok(!readFileSync(lockPathOf(dir), "utf8").includes("dead-nonce"));
  b!.release();
});

test("heartbeat refreshes the lock mtime while held", async () => {
  const dir = tmp();
  const lock = acquireCronTickLock(dir, 30); // 30ms heartbeat (test override)
  assert.ok(lock);
  const before = statSync(lockPathOf(dir)).mtimeMs;
  // Age the file so a heartbeat tick visibly moves mtime forward.
  const past = new Date(Date.now() - 10_000);
  utimesSync(lockPathOf(dir), past, past);
  await new Promise((r) => setTimeout(r, 120));
  const after = statSync(lockPathOf(dir)).mtimeMs;
  lock!.release();
  assert.ok(after >= before - 1, `heartbeat must refresh mtime (before=${before} after=${after})`);
});

test("script job runs without CURSOR_API_KEY (I-140 gate move)", async () => {
  const prev = process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_API_KEY;
  try {
    const dir = tmp();
    writeFileSync(join(dir, "ok.sh"), "#!/bin/sh\necho scripted\n", { mode: 0o755 });
    const out = await executeCronJob(
      { id: "s1", cron: "0 9 * * *", script: "ok.sh" },
      { dir }
    );
    assert.equal(out.ok, true);
    assert.match(out.message, /scripted/);
  } finally {
    if (prev === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prev;
  }
});

test("cursor prompt job is still gated on CURSOR_API_KEY", async () => {
  const prev = process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_API_KEY;
  try {
    const dir = tmp();
    const out = await executeCronJob({ id: "p1", cron: "0 9 * * *", prompt: "hello" }, { dir });
    assert.equal(out.ok, false);
    assert.match(out.message, /CURSOR_API_KEY/);
  } finally {
    if (prev === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prev;
  }
});

test("claude-agent prompt job is not gated on the cursor key", async () => {
  const prev = process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_API_KEY;
  try {
    const dir = tmp();
    writeFileSync(
      join(dir, "agent.config.json"),
      JSON.stringify({ stateDir: ".agent", cwd: dir, engine: { provider: "claude-agent", auth: "account" } }),
      "utf8"
    );
    const out = await executeCronJob(
      { id: "p2", cron: "0 9 * * *", prompt: "hello" },
      {
        dir,
        sdk: { prompt: async () => ({ status: "finished", result: "ok from sdk", id: "r1", agentId: "a1" }) },
      }
    );
    assert.equal(out.ok, true, out.message);
  } finally {
    if (prev === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prev;
  }
});
