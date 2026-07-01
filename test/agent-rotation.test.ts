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

      const events: string[] = [];
      const opened = await openChatSession({
        sdk,
        dir,
        interactive: false,
        onTurnRetry: () => {
          retried = true;
        },
        onAgentRotating: () => events.push("rotating"),
        onAgentRotated: (info) => {
          events.push("rotated");
          rotated.push(info);
        },
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
      assert.match(rotated[0]?.reason ?? "", /run_error|exception/);
      assert.deepEqual(events, ["rotating", "rotated"]);
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

  it("recovers on next turn when createSession fails during rotation", async () => {
    await withKey(async () => {
      const dir = mkdtempSync(resolve(tmpdir(), "rotate-recover-"));
      let createCount = 0;
      let sendCount = 0;

      const sdk: SdkCreateLike = {
        create: async () => {
          createCount++;
          // create #2 — the rotation attempt — fails (SDK briefly down)
          if (createCount === 2) throw new Error("sdk create down");
          const agent: AgentLike = {
            agentId: `agent-${createCount}`,
            send: async () => {
              sendCount++;
              // first send fails with a rotatable error, everything after succeeds
              if (sendCount === 1) {
                throw Object.assign(new Error("agent handle stale"), { code: 13 });
              }
              return okRun("recovered on next turn");
            },
          };
          return agent;
        },
      };

      const opened = await openChatSession({ sdk, dir, interactive: false });
      assert.equal(opened.ok, true);
      if (!opened.ok) return;

      // Turn 1: send fails, rotation create fails → structured error, no throw.
      const first = await opened.session.sendTurn("hello");
      assert.equal(first.kind, "error");

      // Turn 2: engine must notice the dead handle and create a fresh agent.
      const second = await opened.session.sendTurn("are you alive?");
      assert.equal(second.kind, "ok");
      if (second.kind === "ok") assert.equal(second.assistantText, "recovered on next turn");
      assert.equal(createCount, 3);
      await opened.session.close();
    });
  });
});

describe("overload retry (I-133)", () => {
  it("retries an overload error in place (no rotation) and succeeds", async () => {
    await withKey(async () => {
      const dir = mkdtempSync(resolve(tmpdir(), "overload-retry-"));
      let createCount = 0;
      let sendCount = 0;
      let retried = false;

      const sdk: SdkCreateLike = {
        create: async () => {
          createCount++;
          const agent: AgentLike = {
            agentId: "agent-1",
            send: async () => {
              sendCount++;
              if (sendCount === 1) throw new Error("529 Overloaded");
              return okRun("recovered after overload");
            },
          };
          return agent;
        },
      };

      const opened = await openChatSession({
        sdk,
        dir,
        interactive: false,
        overloadRetryDelaysMs: [0, 0], // skip the real 5s/15s backoff in tests
        onTurnRetry: () => {
          retried = true;
        },
      });
      assert.equal(opened.ok, true);
      if (!opened.ok) return;

      const out = await opened.session.sendTurn("hello");
      assert.equal(out.kind, "ok");
      if (out.kind === "ok") assert.equal(out.assistantText, "recovered after overload");
      assert.equal(sendCount, 2);
      assert.equal(createCount, 1); // no rotation — same agent, same session
      assert.equal(retried, true);
      await opened.session.close();
    });
  });

  it("surfaces 'upstream busy' after exhausting the overload retry budget", async () => {
    await withKey(async () => {
      const dir = mkdtempSync(resolve(tmpdir(), "overload-exhaust-"));
      let createCount = 0;
      let sendCount = 0;

      const sdk: SdkCreateLike = {
        create: async () => {
          createCount++;
          const agent: AgentLike = {
            agentId: "agent-1",
            send: async () => {
              sendCount++;
              throw new Error("529 Overloaded"); // never recovers
            },
          };
          return agent;
        },
      };

      const opened = await openChatSession({
        sdk,
        dir,
        interactive: false,
        overloadRetryDelaysMs: [0, 0],
      });
      assert.equal(opened.ok, true);
      if (!opened.ok) return;

      const out = await opened.session.sendTurn("hello");
      assert.equal(out.kind, "error");
      if (out.kind === "error") {
        assert.equal(out.fatal, false);
        assert.match(out.message, /Upstream busy/);
      }
      assert.equal(sendCount, 3); // 1 initial + 2 bounded retries
      assert.equal(createCount, 1); // never rotated
      await opened.session.close();
    });
  });

  it("does not retry an overload error once the turn has produced output", async () => {
    await withKey(async () => {
      const dir = mkdtempSync(resolve(tmpdir(), "overload-partial-"));
      let sendCount = 0;

      const sdk: SdkCreateLike = {
        create: async () => ({
          agentId: "agent-1",
          send: async (): Promise<RunLike> => {
            sendCount++;
            return {
              stream: async function* () {
                yield { type: "text", text: "partial…" };
                throw new Error("529 Overloaded"); // fails mid-stream, after output
              },
              wait: async () => {
                throw new Error("529 Overloaded");
              },
            };
          },
        }),
      };

      const opened = await openChatSession({
        sdk,
        dir,
        interactive: false,
        overloadRetryDelaysMs: [0, 0],
      });
      assert.equal(opened.ok, true);
      if (!opened.ok) return;

      const out = await opened.session.sendTurn("hello");
      assert.equal(out.kind, "error");
      assert.equal(sendCount, 1); // no retry — would re-bill the already-produced output
      await opened.session.close();
    });
  });
});

// claude-agent delivers upstream failures as `is_error` RESULT messages (run.wait()
// → status:"error"), not thrown exceptions — the I-133 catch-path never sees them.
function errorResultRun(detail: string): RunLike {
  const res = { status: "error", id: "r-err", error: detail };
  return {
    stream: async function* () {},
    wait: async () => res,
  };
}

describe("overload retry — run-result error path (I-135)", () => {
  it("retries an overload run-result error in place (no rotation) and succeeds", async () => {
    await withKey(async () => {
      const dir = mkdtempSync(resolve(tmpdir(), "overload-result-retry-"));
      let createCount = 0;
      let sendCount = 0;
      let retried = false;

      const sdk: SdkCreateLike = {
        create: async () => {
          createCount++;
          const agent: AgentLike = {
            agentId: "agent-1",
            send: async () => {
              sendCount++;
              if (sendCount === 1) return errorResultRun("529 Overloaded");
              return okRun("recovered after overload");
            },
          };
          return agent;
        },
      };

      const opened = await openChatSession({
        sdk,
        dir,
        interactive: false,
        overloadRetryDelaysMs: [0, 0],
        onTurnRetry: () => {
          retried = true;
        },
      });
      assert.equal(opened.ok, true);
      if (!opened.ok) return;

      const out = await opened.session.sendTurn("hello");
      assert.equal(out.kind, "ok");
      if (out.kind === "ok") assert.equal(out.assistantText, "recovered after overload");
      assert.equal(sendCount, 2);
      assert.equal(createCount, 1); // no rotation — same agent, same session
      assert.equal(retried, true);
      await opened.session.close();
    });
  });

  it("fails plainly after exhausting the budget — never rotates on overload", async () => {
    await withKey(async () => {
      const dir = mkdtempSync(resolve(tmpdir(), "overload-result-exhaust-"));
      let createCount = 0;
      let sendCount = 0;

      const sdk: SdkCreateLike = {
        create: async () => {
          createCount++;
          const agent: AgentLike = {
            agentId: "agent-1",
            send: async () => {
              sendCount++;
              return errorResultRun("529 Overloaded"); // never recovers
            },
          };
          return agent;
        },
      };

      const opened = await openChatSession({
        sdk,
        dir,
        interactive: false,
        overloadRetryDelaysMs: [0, 0],
      });
      assert.equal(opened.ok, true);
      if (!opened.ok) return;

      const out = await opened.session.sendTurn("hello");
      assert.equal(out.kind, "error");
      if (out.kind === "error") {
        assert.equal(out.fatal, false);
        assert.match(out.message, /Upstream busy/);
      }
      assert.equal(sendCount, 3); // 1 initial + 2 bounded retries
      assert.equal(createCount, 1); // rotation must never fire on overload (I-127)
      await opened.session.close();
    });
  });

  it("does not retry once the turn has produced output; still no rotation", async () => {
    await withKey(async () => {
      const dir = mkdtempSync(resolve(tmpdir(), "overload-result-partial-"));
      let createCount = 0;
      let sendCount = 0;

      const sdk: SdkCreateLike = {
        create: async () => {
          createCount++;
          return {
            agentId: "agent-1",
            send: async (): Promise<RunLike> => {
              sendCount++;
              const res = { status: "error", id: "r-err", error: "529 Overloaded" };
              return {
                stream: async function* () {
                  yield { type: "text", text: "partial…" }; // output already billed
                },
                wait: async () => res,
              };
            },
          };
        },
      };

      const opened = await openChatSession({
        sdk,
        dir,
        interactive: false,
        overloadRetryDelaysMs: [0, 0],
      });
      assert.equal(opened.ok, true);
      if (!opened.ok) return;

      const out = await opened.session.sendTurn("hello");
      assert.equal(out.kind, "error");
      assert.equal(sendCount, 1); // no retry — would re-bill the already-produced output
      assert.equal(createCount, 1); // and no rotation either
      await opened.session.close();
    });
  });

  it("still rotates on non-overload run-result errors", async () => {
    await withKey(async () => {
      const dir = mkdtempSync(resolve(tmpdir(), "result-error-rotate-"));
      let createCount = 0;
      let sendCount = 0;

      const sdk: SdkCreateLike = {
        create: async () => {
          createCount++;
          const agent: AgentLike = {
            agentId: createCount === 1 ? "agent-old" : "agent-new",
            send: async () => {
              sendCount++;
              if (sendCount === 1) return errorResultRun("tool crashed: exit 1");
              return okRun("recovered via rotation");
            },
          };
          return agent;
        },
      };

      const opened = await openChatSession({
        sdk,
        dir,
        interactive: false,
        overloadRetryDelaysMs: [0, 0],
      });
      assert.equal(opened.ok, true);
      if (!opened.ok) return;

      const out = await opened.session.sendTurn("hello");
      assert.equal(out.kind, "ok");
      if (out.kind === "ok") assert.equal(out.assistantText, "recovered via rotation");
      assert.equal(createCount, 2); // rotation path unchanged for non-overload errors
      await opened.session.close();
    });
  });
});
