import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  applyContextFromPlaceholder,
  CONTEXT_FROM_PLACEHOLDER,
  orderJobsForContextPipeline,
  resolveContextFromOutput,
  validateContextFromGraph,
} from "../src/cronContextFrom.js";
import { saveCronContextArtifact } from "../src/cronContextArtifact.js";
import { executeCronJob, cronTick } from "../src/cronEngine.js";
import { CronJobsError, loadCronJobs, saveCronJobs, type CronJob } from "../src/cronJobs.js";
import type { SdkLike } from "../src/host.js";

function tmp(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "cron-ctx-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ model: "m", runtime: "local", cwd: dir, stateDir: ".agent" }),
    "utf8"
  );
  return dir;
}

async function withKey<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = "k";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prev;
  }
}

test("validateContextFromGraph rejects unknown ref and cycles", () => {
  assert.throws(
    () =>
      validateContextFromGraph([
        { id: "b", cron: "0 8 * * *", prompt: "x", contextFrom: "missing" },
      ]),
    CronJobsError
  );
  assert.throws(
    () =>
      validateContextFromGraph([
        { id: "a", cron: "0 8 * * *", prompt: "x", contextFrom: "b" },
        { id: "b", cron: "0 8 * * *", prompt: "y", contextFrom: "a" },
      ]),
    /cycle/i
  );
});

test("resolveContextFromOutput loads upstream artifact", () => {
  const dir = tmp();
  saveCronContextArtifact(dir, "upstream", {
    ok: true,
    exitCode: 0,
    message: "ok",
    output: "hello upstream",
    durationMs: 1,
  });
  const out = resolveContextFromOutput(
    { id: "down", cron: "0 9 * * *", prompt: "x", contextFrom: "upstream" },
    dir
  );
  assert.equal(out.output, "hello upstream");
  assert.equal(out.missing, false);
});

test("applyContextFromPlaceholder substitutes {{context_from}}", () => {
  const text = `Before\n${CONTEXT_FROM_PLACEHOLDER}\nAfter`;
  assert.match(applyContextFromPlaceholder(text, "BODY"), /BODY/);
});

test("orderJobsForContextPipeline runs upstream first", () => {
  const jobs: CronJob[] = [
    { id: "b", cron: "0 8 * * *", prompt: "b", contextFrom: "a" },
    { id: "a", cron: "0 8 * * *", script: "echo a" },
  ];
  const ordered = orderJobsForContextPipeline(jobs);
  assert.equal(ordered[0]?.id, "a");
  assert.equal(ordered[1]?.id, "b");
});

test("executeCronJob injects contextFrom into prompt job", async () => {
  await withKey(async () => {
    const dir = tmp();
    saveCronContextArtifact(dir, "src", {
      ok: true,
      exitCode: 0,
      message: "ok",
      output: "UPSTREAM_DATA_123",
      durationMs: 1,
    });
    let sawUpstream = false;
    const sdk: SdkLike = {
      prompt: async (p: string) => {
        if (p.includes("UPSTREAM_DATA_123")) sawUpstream = true;
        return { status: "finished", result: "done", id: "r1", agentId: "a1" };
      },
    };
    const job: CronJob = {
      id: "dst",
      cron: "0 8 * * *",
      contextFrom: "src",
      prompt: `Summarize:\n${CONTEXT_FROM_PLACEHOLDER}`,
    };
    const exec = await executeCronJob(job, { dir, sdk, checkSafety: false });
    assert.equal(exec.ok, true);
    assert.equal(sawUpstream, true);
  });
});

test("cronTick runs script upstream before prompt downstream", async () => {
  await withKey(async () => {
    const dir = tmp();
    const scriptPath = join(dir, "pipe.sh");
    writeFileSync(scriptPath, "#!/bin/sh\necho tick-upstream-999\n", { mode: 0o755 });
    saveCronJobs(dir, [
      { id: "pipe-dst", cron: "* * * * *", contextFrom: "pipe-src", prompt: `Data: ${CONTEXT_FROM_PLACEHOLDER}` },
      { id: "pipe-src", cron: "* * * * *", script: scriptPath },
    ]);
    let sawUpstream = false;
    const sdk: SdkLike = {
      prompt: async (p: string) => {
        if (p.includes("tick-upstream-999")) sawUpstream = true;
        return { status: "finished", result: "ok", id: "r", agentId: "a" };
      },
    };
    const result = await cronTick({ dir, force: true, sdk, checkSafety: false });
    assert.ok(result.ran.includes("pipe-src"));
    assert.ok(result.ran.includes("pipe-dst"));
    assert.equal(sawUpstream, true);
  });
});

test("cronTick skips downstream when upstream script fails", async () => {
  await withKey(async () => {
    const dir = tmp();
    const badScript = join(dir, "bad.sh");
    writeFileSync(badScript, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    saveCronJobs(dir, [
      { id: "pipe-src", cron: "* * * * *", script: badScript },
      {
        id: "pipe-dst",
        cron: "* * * * *",
        contextFrom: "pipe-src",
        prompt: `Data: ${CONTEXT_FROM_PLACEHOLDER}`,
      },
    ]);
    let promptRan = false;
    const sdk: SdkLike = {
      prompt: async () => {
        promptRan = true;
        return { status: "finished", result: "ok", id: "r", agentId: "a" };
      },
    };
    const result = await cronTick({ dir, force: true, sdk, checkSafety: false });
    assert.ok(result.errors.some((e) => e.id === "pipe-src"));
    assert.ok(result.skipped.includes("pipe-dst"));
    assert.equal(promptRan, false);
  });
});
