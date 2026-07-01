import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openChatSession } from "../src/chatEngine.js";
import { createStore, type IStore } from "../src/store.js";
import type { AgentLike, RunLike, SdkCreateLike } from "../src/host.js";

// I-137 (audit 2026-07-02 H-2): a down Postgres must DEGRADE a turn, never
// fail it, and never re-execute an already-completed turn (double billing).
// Postmortem 2026-06-18: PG down -> long-poll alive but every turn failed.

function withKey(fn: () => Promise<void>): Promise<void> {
  const prev = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = "test-key";
  return fn().finally(() => {
    if (prev === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prev;
  });
}

function okRun(text: string): RunLike {
  return {
    stream: async function* () {
      yield { type: "text", text };
    },
    wait: async () => ({ status: "finished", id: "r-ok" }),
  };
}

/** Real sqlite store with selected methods overridden to fail like a dead PG. */
function storeFailingOn(dir: string, methods: Array<"recordRun" | "upsertSession">): IStore {
  const real = createStore(dir, ".agent");
  const broken = Object.create(real) as IStore;
  for (const m of methods) {
    (broken as unknown as Record<string, unknown>)[m] = async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:5435 (simulated PG outage)");
    };
  }
  return broken;
}

describe("store resilience in sendTurn (I-137)", () => {
  it("recordRun failure does not fail the turn and does not re-execute it", async () => {
    await withKey(async () => {
      const dir = mkdtempSync(resolve(tmpdir(), "resil-record-"));
      let sendCount = 0;
      const sdk: SdkCreateLike = {
        create: async () => ({
          agentId: "agent-1",
          send: async () => {
            sendCount++;
            return okRun("answered");
          },
        }),
      };
      const opened = await openChatSession({
        sdk,
        dir,
        interactive: false,
        store: storeFailingOn(dir, ["recordRun"]),
      });
      assert.equal(opened.ok, true);
      if (!opened.ok) return;
      const out = await opened.session.sendTurn("hello");
      assert.equal(out.kind, "ok");
      if (out.kind === "ok") assert.equal(out.assistantText, "answered");
      assert.equal(sendCount, 1); // the completed turn must NOT be re-sent (double billing)
      await opened.session.close();
    });
  });

  it("upsertSession failure does not fail the turn", async () => {
    await withKey(async () => {
      const dir = mkdtempSync(resolve(tmpdir(), "resil-upsert-"));
      let sendCount = 0;
      const sdk: SdkCreateLike = {
        create: async () => ({
          agentId: "agent-1",
          send: async () => {
            sendCount++;
            return okRun("answered");
          },
        }),
      };
      const opened = await openChatSession({
        sdk,
        dir,
        interactive: false,
        store: storeFailingOn(dir, ["recordRun", "upsertSession"]),
      });
      assert.equal(opened.ok, true);
      if (!opened.ok) return;
      const out = await opened.session.sendTurn("hello");
      assert.equal(out.kind, "ok");
      assert.equal(sendCount, 1);
      await opened.session.close();
    });
  });

  it("store failure during SDK-error handling still returns a structured error path", async () => {
    await withKey(async () => {
      const dir = mkdtempSync(resolve(tmpdir(), "resil-error-"));
      let sendCount = 0;
      const sdk: SdkCreateLike = {
        create: async () => {
          const agent: AgentLike = {
            agentId: "agent-1",
            send: async () => {
              sendCount++;
              if (sendCount === 1) throw Object.assign(new Error("agent handle stale"), { code: 13 });
              return okRun("recovered");
            },
          };
          return agent;
        },
      };
      const opened = await openChatSession({
        sdk,
        dir,
        interactive: false,
        store: storeFailingOn(dir, ["recordRun", "upsertSession"]),
      });
      assert.equal(opened.ok, true);
      if (!opened.ok) return;
      // Rotation recovery must still work even when the store is down.
      const out = await opened.session.sendTurn("hello");
      assert.equal(out.kind, "ok");
      if (out.kind === "ok") assert.equal(out.assistantText, "recovered");
      await opened.session.close();
    });
  });
});

describe("memory injection resilience in sendTurn (I-137)", () => {
  it("autoRag against a dead Postgres degrades the turn instead of failing it", async () => {
    await withKey(async () => {
      const dir = mkdtempSync(resolve(tmpdir(), "resil-autorag-"));
      mkdirSync(join(dir, ".agent"), { recursive: true });
      writeFileSync(
        join(dir, "agent.config.json"),
        JSON.stringify({
          stateDir: ".agent",
          cwd: dir,
          memory: { autoRag: { enabled: true, limit: 2 } },
        }),
        "utf8"
      );
      // Create the session store while env is clean (sqlite) so the test
      // isolates the MEMORY path — only autoRag sees the dead PG below.
      const healthyStore = createStore(dir, ".agent");
      const prevUrl = process.env.IRIDA_DATABASE_URL;
      const prevKey = process.env.IRIDA_SECRETS_KEY;
      // Port 1 refuses immediately — a fast, deterministic "PG is down".
      process.env.IRIDA_DATABASE_URL = "postgresql://x:x@127.0.0.1:1/na";
      process.env.IRIDA_SECRETS_KEY = "resilience-test-secrets-key-32chars";
      let sendCount = 0;
      const sdk: SdkCreateLike = {
        create: async () => ({
          agentId: "agent-1",
          send: async () => {
            sendCount++;
            return okRun("answered without memory");
          },
        }),
      };
      try {
        const opened = await openChatSession({
          sdk,
          dir,
          interactive: false,
          store: healthyStore,
        });
        assert.equal(opened.ok, true);
        if (!opened.ok) return;
        const out = await opened.session.sendTurn("hello");
        assert.equal(out.kind, "ok");
        if (out.kind === "ok") assert.equal(out.assistantText, "answered without memory");
        assert.equal(sendCount, 1);
        await opened.session.close();
      } finally {
        if (prevUrl === undefined) delete process.env.IRIDA_DATABASE_URL;
        else process.env.IRIDA_DATABASE_URL = prevUrl;
        if (prevKey === undefined) delete process.env.IRIDA_SECRETS_KEY;
        else process.env.IRIDA_SECRETS_KEY = prevKey;
      }
    });
  });
});
