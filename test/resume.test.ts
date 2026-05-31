import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { cmdResume } from "../src/resume.js";
import { Store } from "../src/store.js";
import type { SdkResumeLike, SdkCreateLike, RunLike, AgentLike } from "../src/host.js";

type ResumeSdk = SdkResumeLike & SdkCreateLike;

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

async function seedSession(dir: string, agentId: string | null): Promise<string> {
  const s = new Store(dir, ".agent");
  const id = "sess_seed";
  await s.upsertSession({ id, title: "seed", cwd: dir, runtime: "local", sdk_agent_id: agentId, last_status: "finished" });
  await s.recordRun({
    id: "run_prior",
    session_id: id,
    sdk_agent_id: agentId,
    sdk_run_id: "rp",
    prompt_preview: "earlier question",
    result_preview: "earlier answer",
    status: "finished",
    error_kind: null,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    cwd: dir,
    runtime: "local",
    model: "composer-2.5",
  });
  await s.close();
  return id;
}

function agent(disposed: { v: boolean }, id = "agent_new"): AgentLike {
  return {
    agentId: id,
    send: async (m: string): Promise<RunLike> => ({
      stream: async function* () {
        yield { type: "assistant", message: { content: [{ type: "text", text: `r:${m}` }] } };
      },
      wait: async () => ({ status: "finished", id: "run_x" }),
    }),
    [Symbol.asyncDispose]: async () => {
      disposed.v = true;
    },
  };
}

/** resume ok + create ok */
function liveSdk(d: { v: boolean }): ResumeSdk {
  return { resume: async () => agent(d, "agent_resumed"), create: async () => agent(d, "agent_created") };
}
/** resume throws, create ok -> replay path */
function replaySdk(d: { v: boolean }): ResumeSdk {
  return {
    resume: async () => {
      throw new Error("Agent not found");
    },
    create: async () => agent(d, "agent_created"),
  };
}
/** both fail */
function deadSdk(): ResumeSdk {
  return {
    resume: async () => {
      throw new Error("resume down");
    },
    create: async () => {
      throw new Error("create down");
    },
  };
}

test("live resume success -> 0, new run persisted", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const id = await seedSession(dir, "agent-123");
    const d = { v: false };
    let out = "";
    const code = await cmdResume(id, "continue", { sdk: liveSdk(d), dir, write: (s) => (out += s) });
    assert.equal(code, 0);
    assert.match(out, /r:continue/);
    assert.equal(d.v, true);
    const store = new Store(dir, ".agent");
    assert.equal((await store.listRuns(id)).length, 2); // prior + new
    await store.close();
  });
});

test("missing session -> EX_USAGE 64", async () => {
  await withKey("k", async () => {
    assert.equal(await cmdResume("nope", "hi", { sdk: liveSdk({ v: false }), dir: tmp() }), 64);
  });
});

test("no stored agent id -> transcript replay -> 0", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const id = await seedSession(dir, null);
    const code = await cmdResume(id, "go on", { sdk: liveSdk({ v: false }), dir, write: () => {} });
    assert.equal(code, 0);
  });
});

test("live resume fails -> transcript replay -> 0", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const id = await seedSession(dir, "agent-123");
    const code = await cmdResume(id, "go on", { sdk: replaySdk({ v: false }), dir, write: () => {} });
    assert.equal(code, 0);
    const store = new Store(dir, ".agent");
    assert.equal((await store.getSession(id))!.sdk_agent_id, "agent_created"); // updated to replay agent
    await store.close();
  });
});

test("resume and replay both fail -> EX_SOFTWARE 70", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const id = await seedSession(dir, "agent-123");
    assert.equal(await cmdResume(id, "go", { sdk: deadSdk(), dir, write: () => {} }), 70);
    const store = new Store(dir, ".agent");
    assert.ok(await store.getSession(id)); // state intact
    await store.close();
  });
});

test("destructive prompt -> EX_NOPERM 77", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const id = await seedSession(dir, "agent-123");
    assert.equal(await cmdResume(id, "rm -rf /", { sdk: liveSdk({ v: false }), dir, write: () => {} }), 77);
  });
});