import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { cmdRun } from "../src/run.js";
import { Store } from "../src/store.js";
import type { SdkLike } from "../src/host.js";

function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), "run-"));
}

function fakeSdk(impl: SdkLike["prompt"]): SdkLike {
  return { prompt: impl };
}

async function withKey<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.CURSOR_API_KEY;
  if (value === undefined) delete process.env.CURSOR_API_KEY;
  else process.env.CURSOR_API_KEY = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prev;
  }
}

test("finished run -> exit 0 and persisted to sqlite", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const sdk = fakeSdk(async () => ({ status: "finished", result: "hello", id: "r1", agentId: "a1" }));
    const code = await cmdRun("hi", { sdk, dir });
    assert.equal(code, 0);
    const store = new Store(dir, ".agent");
    const sessions = store.listSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].last_status, "finished");
    const runs = store.listRuns(sessions[0].id);
    assert.equal(runs[0].sdk_run_id, "r1");
    store.close();
  });
});

test("destructive prompt -> EX_NOPERM 77 (non-interactive)", async () => {
  await withKey("k", async () => {
    let called = false;
    const sdk = fakeSdk(async () => {
      called = true;
      return { status: "finished" };
    });
    const code = await cmdRun("rm -rf /tmp/x", { sdk, dir: tmp() });
    assert.equal(code, 77);
    assert.equal(called, false);
  });
});

test("destructive prompt + --yes-i-understand -> proceeds", async () => {
  await withKey("k", async () => {
    const sdk = fakeSdk(async () => ({ status: "finished", result: "done", id: "r" }));
    const code = await cmdRun("rm -rf /tmp/x", { sdk, dir: tmp(), yesIUnderstand: true });
    assert.equal(code, 0);
  });
});

test("executed error status -> EX_SOFTWARE 70", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const sdk = fakeSdk(async () => ({ status: "error", id: "r2" }));
    const code = await cmdRun("hi", { sdk, dir });
    assert.equal(code, 70);
  });
});

test("thrown SDK error -> EX_SOFTWARE 70", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const sdk = fakeSdk(async () => {
      throw new Error("401 auth");
    });
    const code = await cmdRun("hi", { sdk, dir });
    assert.equal(code, 70);
  });
});

test("missing API key -> EX_CONFIG 78 before SDK", async () => {
  await withKey(undefined, async () => {
    const dir = tmp();
    let called = false;
    const sdk = fakeSdk(async () => {
      called = true;
      return { status: "finished" };
    });
    const code = await cmdRun("hi", { sdk, dir });
    assert.equal(code, 78);
    assert.equal(called, false);
  });
});

test("empty prompt -> EX_USAGE 64", async () => {
  await withKey("k", async () => {
    const code = await cmdRun("   ", { sdk: fakeSdk(async () => ({ status: "finished" })), dir: tmp() });
    assert.equal(code, 64);
  });
});
