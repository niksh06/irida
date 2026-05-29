import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { cmdResume } from "../src/resume.js";
import { Store } from "../src/store.js";
import type { SdkResumeLike, RunLike } from "../src/host.js";

function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), "resume-"));
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

function seedSession(dir: string, agentId: string | null): string {
  const s = new Store(dir, ".agent");
  const id = "sess_seed";
  s.upsertSession({ id, title: "seed", cwd: dir, runtime: "local", sdk_agent_id: agentId, last_status: "finished" });
  s.close();
  return id;
}

function okSdk(disposed: { v: boolean }): SdkResumeLike {
  return {
    resume: async () => ({
      agentId: "a1",
      send: async (msg: string): Promise<RunLike> => ({
        stream: async function* () {
          yield { type: "assistant", message: { content: [{ type: "text", text: `r:${msg}` }] } };
        },
        wait: async () => ({ status: "finished", id: "run_x" }),
      }),
      [Symbol.asyncDispose]: async () => {
        disposed.v = true;
      },
    }),
  };
}

test("successful resume -> exit 0, persists new run, disposes", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const id = seedSession(dir, "agent-123");
    const disposed = { v: false };
    let out = "";
    const code = await cmdResume(id, "continue please", { sdk: okSdk(disposed), dir, write: (s) => (out += s) });
    assert.equal(code, 0);
    assert.match(out, /r:continue please/);
    assert.equal(disposed.v, true);
    const store = new Store(dir, ".agent");
    assert.equal(store.listRuns(id).length, 1);
    store.close();
  });
});

test("missing session -> exit 1", async () => {
  await withKey("k", async () => {
    const code = await cmdResume("sess_nope", "hi", { sdk: okSdk({ v: false }), dir: tmp() });
    assert.equal(code, 1);
  });
});

test("session without sdk_agent_id -> exit 1", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const id = seedSession(dir, null);
    const code = await cmdResume(id, "hi", { sdk: okSdk({ v: false }), dir });
    assert.equal(code, 1);
  });
});

test("SDK resume failure -> exit 1, state intact", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const id = seedSession(dir, "agent-123");
    const sdk: SdkResumeLike = {
      resume: async () => {
        throw new Error("resume unavailable");
      },
    };
    const code = await cmdResume(id, "hi", { sdk, dir });
    assert.equal(code, 1);
    const store = new Store(dir, ".agent");
    assert.ok(store.getSession(id)); // session still present
    store.close();
  });
});

test("destructive prompt -> exit 3", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const id = seedSession(dir, "agent-123");
    const code = await cmdResume(id, "rm -rf /", { sdk: okSdk({ v: false }), dir });
    assert.equal(code, 3);
  });
});
