/**
 * MVP acceptance harness (issue 012). Drives the real command functions
 * against a temp workspace with a MOCKED Cursor SDK (no live calls -> CI-safe).
 * Covers: doctor (missing key), one-shot run, two-turn chat, session listing,
 * resume success (mock), resume failure, redaction, destructive confirm/deny.
 *
 * Run from a clean checkout:  npm install && npm run accept
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { cmdDoctor } from "../src/doctor.js";
import { cmdRun } from "../src/run.js";
import { cmdChat } from "../src/chat.js";
import { cmdSessions } from "../src/sessions_cmd.js";
import { cmdResume } from "../src/resume.js";
import { Store } from "../src/store.js";
import type { SdkLike, SdkCreateLike, SdkResumeLike, RunLike, AgentLike } from "../src/host.js";

function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), "accept-"));
}

async function withKey<T>(value: string | undefined, fn: () => Promise<T> | T): Promise<T> {
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

function chatAgent(disposed: { v: boolean }, agentId = "agent_chat"): AgentLike {
  return {
    agentId,
    send: async (m: string): Promise<RunLike> => ({
      stream: async function* () {
        yield { type: "assistant", message: { content: [{ type: "text", text: `reply:${m}` }] } };
      },
      wait: async () => ({ status: "finished", id: "run_chat" }),
    }),
    [Symbol.asyncDispose]: async () => {
      disposed.v = true;
    },
  };
}

/** Combined mock implementing all three SDK surfaces. */
function mockSdk(disposed: { v: boolean }): SdkLike & SdkCreateLike & SdkResumeLike {
  return {
    prompt: async (msg) => ({ status: "finished", result: `ran:${msg}`, id: "run_os", agentId: "agent_os" }),
    create: async () => chatAgent(disposed),
    resume: async (agentId: string) => {
      if (agentId === "agent_fail") throw new Error("Agent not found");
      return chatAgent(disposed, agentId);
    },
  };
}

test("acceptance: doctor reflects API key presence", async () => {
  const mockList = { listModels: async () => [{ id: "composer-2.5" }] };
  await withKey(undefined, async () => assert.equal(await cmdDoctor(tmp()), 1));
  await withKey("crsr_" + "a".repeat(24), async () => assert.equal(await cmdDoctor(tmp(), mockList), 0));
});

test("acceptance: run -> chat -> sessions -> resume flow", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const disposed = { v: false };
    const sdk = mockSdk(disposed);

    // 1) one-shot run
    assert.equal(await cmdRun("summarize repo", { sdk, dir }), 0);

    // 2) interactive chat, two turns
    assert.equal(
      await cmdChat({ sdk, dir, lines: ["first", "second", "exit"], interactive: false, write: () => {} }),
      0
    );

    // 3) sessions lists both
    const store = new Store(dir, ".agent");
    const sessions = await store.listSessions();
    assert.ok(sessions.length >= 2, `expected >=2 sessions, got ${sessions.length}`);
    assert.equal(await cmdSessions(dir), 0);

    // 4) resume the chat session (has sdk_agent_id) -> success
    const chatSession = sessions.find((s) => s.sdk_agent_id === "agent_chat");
    assert.ok(chatSession, "chat session with agent id present");
    const beforeRuns = (await store.listRuns(chatSession!.id)).length;
    assert.equal(await cmdResume(chatSession!.id, "follow up", { sdk, dir, write: () => {} }), 0);
    assert.equal((await store.listRuns(chatSession!.id)).length, beforeRuns + 1);

    // 5) live resume rejected -> transcript replay succeeds (exit 0)
    await store.upsertSession({ id: "sess_fail", title: "f", cwd: dir, runtime: "local", sdk_agent_id: "agent_fail" });
    assert.equal(await cmdResume("sess_fail", "go", { sdk, dir, write: () => {} }), 0);

    // 6) resume AND replay both fail -> EX_SOFTWARE 70, state intact
    const dead = {
      prompt: async () => ({ status: "finished" }),
      create: async () => {
        throw new Error("create down");
      },
      resume: async () => {
        throw new Error("resume down");
      },
    };
    assert.equal(await cmdResume("sess_fail", "go", { sdk: dead, dir, write: () => {} }), 70);
    assert.ok(await store.getSession("sess_fail"), "failed resume leaves session intact");
    await store.close();
  });
});

test("acceptance: destructive prompts gated", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const disposed = { v: false };
    const sdk = mockSdk(disposed);

    // one-shot destructive -> denied (EX_NOPERM 77)
    assert.equal(await cmdRun("please rm -rf /tmp/foo", { sdk, dir }), 77);
    // ...unless explicitly overridden
    assert.equal(await cmdRun("rm -rf /tmp/foo", { sdk, dir, yesIUnderstand: true }), 0);

    // chat destructive confirmed -> proceeds
    assert.equal(
      await cmdChat({
        sdk,
        dir,
        lines: ["rm -rf build", "exit"],
        interactive: true,
        confirm: async () => true,
        write: () => {},
      }),
      0
    );

    // chat destructive declined -> blocked but session ends cleanly
    assert.equal(
      await cmdChat({
        sdk,
        dir,
        lines: ["rm -rf build", "exit"],
        interactive: true,
        confirm: async () => false,
        write: () => {},
      }),
      0
    );
  });
});

test("acceptance: secrets redacted in persisted state", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const disposed = { v: false };
    await cmdRun("use CURSOR_API_KEY=key_supersecret123 now", { sdk: mockSdk(disposed), dir });
    const store = new Store(dir, ".agent");
    const sess = await store.listSessions();
    const runs = await store.listRuns(sess[0].id);
    const blob = JSON.stringify(sess) + JSON.stringify(runs);
    assert.doesNotMatch(blob, /key_supersecret123/);
    assert.match(blob, /<redacted>/);
    await store.close();
  });
});
