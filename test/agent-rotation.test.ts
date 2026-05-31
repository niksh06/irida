import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { openChatSession, type AgentRotatedInfo } from "../src/chatEngine.js";
import type { AgentLike, RunLike, SdkCreateLike } from "../src/host.js";

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

describe("in-session agent rotation", () => {
  it("rotates and retries once on rotatable failure", async () => {
    await withKey(async () => {
      const dir = mkdtempSync(resolve(tmpdir(), "rotate-"));
      let sendCount = 0;
      let createCount = 0;
      let disposed = 0;
      const rotated: AgentRotatedInfo[] = [];
      let retried = false;

      const sdk: SdkCreateLike = {
        create: async () => {
          createCount++;
          const agentId = createCount === 1 ? "agent-old" : "agent-new";
          const agent: AgentLike = {
            agentId,
            send: async () => {
              sendCount++;
              if (sendCount === 1) {
                throw Object.assign(new Error("agent handle stale"), { code: 13 });
              }
              return okRun("recovered");
            },
            close: async () => {
              disposed++;
            },
          };
          return agent;
        },
      };

      const opened = await openChatSession({
        sdk,
        dir,
        interactive: false,
        onTurnRetry: () => {
          retried = true;
        },
        onAgentRotated: (info) => rotated.push(info),
      });
      assert.equal(opened.ok, true);
      if (!opened.ok) return;

      const out = await opened.session.sendTurn("hello");
      assert.equal(out.kind, "ok");
      if (out.kind === "ok") assert.equal(out.assistantText, "recovered");
      assert.equal(createCount, 2);
      assert.equal(sendCount, 2);
      assert.equal(disposed, 1);
      assert.equal(retried, true);
      assert.equal(rotated.length, 1);
      assert.equal(rotated[0]?.previousAgentId, "agent-old");
      assert.equal(rotated[0]?.newAgentId, "agent-new");
      assert.equal(opened.session.agentId, "agent-new");
      await opened.session.close();
    });
  });

  it("does not rotate on auth errors", async () => {
    await withKey(async () => {
      const dir = mkdtempSync(resolve(tmpdir(), "rotate-auth-"));
      let createCount = 0;
      const authErr = Object.assign(new Error("Error"), {
        code: 16,
        details: [
          {
            debug: {
              error: "ERROR_NOT_LOGGED_IN",
              details: { title: "Authentication error", detail: "log in again" },
            },
          },
        ],
      });

      const sdk: SdkCreateLike = {
        create: async () => {
          createCount++;
          return {
            agentId: "agent-1",
            send: async (): Promise<RunLike> => ({
              stream: async function* () {
                throw authErr;
              },
              wait: async () => {
                throw authErr;
              },
            }),
          };
        },
      };

      const opened = await openChatSession({ sdk, dir, interactive: false });
      assert.equal(opened.ok, true);
      if (!opened.ok) return;

      const out = await opened.session.sendTurn("hello");
      assert.equal(out.kind, "error");
      if (out.kind === "error") {
        assert.equal(out.fatal, false);
        assert.match(out.message, /Authentication failed/);
      }
      assert.equal(createCount, 1);
      await opened.session.close();
    });
  });

  it("rotates and retries once on SDK status=error", async () => {
    await withKey(async () => {
      const dir = mkdtempSync(resolve(tmpdir(), "rotate-status-"));
      let sendCount = 0;
      let createCount = 0;
      const sdk: SdkCreateLike = {
        create: async () => {
          createCount++;
          const agentId = createCount === 1 ? "agent-old" : "agent-new";
          return {
            agentId,
            send: async () => {
              sendCount++;
              if (sendCount === 1) {
                return {
                  stream: async function* () {},
                  wait: async () => ({ status: "error", id: "r-fail" }),
                };
              }
              return okRun("recovered after status error");
            },
          };
        },
      };

      const opened = await openChatSession({ sdk, dir, interactive: false });
      assert.equal(opened.ok, true);
      if (!opened.ok) return;

      const out = await opened.session.sendTurn("hello");
      assert.equal(out.kind, "ok");
      if (out.kind === "ok") assert.equal(out.assistantText, "recovered after status error");
      assert.equal(createCount, 2);
      assert.equal(sendCount, 2);
      await opened.session.close();
    });
  });

  it("returns error when rotation retry also fails", async () => {
    await withKey(async () => {
      const dir = mkdtempSync(resolve(tmpdir(), "rotate-fail-"));
      let sendCount = 0;

      const sdk: SdkCreateLike = {
        create: async () => ({
          agentId: `agent-${++sendCount}`,
          send: async () => {
            throw Object.assign(new Error("still broken"), { code: 13 });
          },
        }),
      };

      const opened = await openChatSession({ sdk, dir, interactive: false });
      assert.equal(opened.ok, true);
      if (!opened.ok) return;

      const out = await opened.session.sendTurn("hello");
      assert.equal(out.kind, "error");
      if (out.kind === "error") assert.match(out.message, /still broken/);
      await opened.session.close();
    });
  });
});
