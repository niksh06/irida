import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { isAgentIdle, resolveAgentIdleMs } from "../src/agentIdle.js";
import { openChatSession, type AgentRotatedInfo } from "../src/chatEngine.js";
import type { AgentLike, RunLike, SdkCreateLike } from "../src/host.js";

function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void | Promise<void>
): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

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

describe("agentIdle", () => {
  it("resolveAgentIdleMs defaults to 20 minutes", async () => {
    await withEnv({ CSAGENT_AGENT_IDLE_MS: undefined }, () => {
      assert.equal(resolveAgentIdleMs(), 20 * 60 * 1000);
    });
  });

  it("resolveAgentIdleMs respects zero to disable", async () => {
    await withEnv({ CSAGENT_AGENT_IDLE_MS: "0" }, () => {
      assert.equal(resolveAgentIdleMs(), 0);
      assert.equal(isAgentIdle(0), false);
    });
  });

  it("isAgentIdle true when elapsed exceeds threshold", async () => {
    await withEnv({ CSAGENT_AGENT_IDLE_MS: "1000" }, () => {
      assert.equal(isAgentIdle(Date.now() - 2000), true);
      assert.equal(isAgentIdle(Date.now() - 500), false);
    });
  });
});

describe("proactive idle refresh", () => {
  it("refreshes agent before send when idle TTL exceeded", async () => {
    await withKey(async () => {
      await withEnv({ CSAGENT_AGENT_IDLE_MS: "1" }, async () => {
        const dir = mkdtempSync(resolve(tmpdir(), "idle-"));
        let createCount = 0;
        let sendCount = 0;
        const rotated: AgentRotatedInfo[] = [];
        let retryReason = "";

        const sdk: SdkCreateLike = {
          create: async () => {
            createCount++;
            const agentId = `agent-${createCount}`;
            const agent: AgentLike = {
              agentId,
              send: async () => {
                sendCount++;
                return okRun("after idle refresh");
              },
              close: async () => {},
            };
            return agent;
          },
        };

        const opened = await openChatSession({
          sdk,
          dir,
          interactive: false,
          onTurnRetry: (reason) => {
            retryReason = reason ?? "";
          },
          onAgentRotated: (info) => rotated.push(info),
        });
        assert.equal(opened.ok, true);
        if (!opened.ok) return;

        await new Promise((r) => setTimeout(r, 5));

        const out = await opened.session.sendTurn("hello after idle");
        assert.equal(out.kind, "ok");
        if (out.kind === "ok") assert.equal(out.assistantText, "after idle refresh");
        assert.equal(createCount, 2);
        assert.equal(sendCount, 1);
        assert.equal(rotated.length, 1);
        assert.match(rotated[0]?.reason ?? "", /idle_ttl/);
        assert.match(retryReason, /idle_ttl/);
        await opened.session.close();
      });
    });
  });

  it("keeps the live agent and serves the turn when an idle refresh fails (I-111)", async () => {
    await withKey(async () => {
      await withEnv({ CSAGENT_AGENT_IDLE_MS: "1" }, async () => {
        const dir = mkdtempSync(resolve(tmpdir(), "idle-fail-"));
        let createCount = 0;
        let sendCount = 0;
        let disposed = 0;

        const sdk: SdkCreateLike = {
          create: async () => {
            createCount++;
            // Every refresh attempt fails (SDK briefly unreachable). Only the
            // original agent (create #1) exists and works.
            if (createCount >= 2) throw new Error("sdk create down");
            const agent: AgentLike = {
              agentId: "agent-1",
              send: async () => {
                sendCount++;
                return okRun("served by the original agent");
              },
              close: async () => {
                disposed++;
              },
            };
            return agent;
          },
        };

        const opened = await openChatSession({ sdk, dir, interactive: false });
        assert.equal(opened.ok, true);
        if (!opened.ok) return;

        await new Promise((r) => setTimeout(r, 5)); // exceed the 1ms idle TTL

        const out = await opened.session.sendTurn("hello after idle");
        // Idle refresh failed, but the original agent was never disposed, so the
        // turn completes on it instead of erroring on a dead handle.
        assert.equal(out.kind, "ok");
        if (out.kind === "ok") assert.equal(out.assistantText, "served by the original agent");
        assert.equal(createCount, 2); // one failed refresh attempt
        assert.equal(sendCount, 1); // served once, by the original agent
        assert.equal(disposed, 0); // original agent NOT disposed
        assert.equal(opened.session.agentId, "agent-1");
        await opened.session.close();
      });
    });
  });
});
