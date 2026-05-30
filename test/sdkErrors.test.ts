import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { formatSdkError, consumeRunStream, isAgentRotatableError } from "../src/sdkErrors.js";
import { openChatSession } from "../src/chatEngine.js";
import type { RunLike, SdkCreateLike } from "../src/host.js";

describe("formatSdkError", () => {
  it("parses Connect auth error details", () => {
    const err = {
      message: "Error",
      code: 16,
      details: [
        {
          debug: {
            error: "ERROR_NOT_LOGGED_IN",
            details: {
              title: "Authentication error",
              detail: "If you are logged in, try logging out and back in.",
            },
          },
        },
      ],
    };
    const out = formatSdkError(err);
    assert.equal(out.errorKind, "auth");
    assert.equal(out.recoverable, true);
    assert.equal(out.rotatable, false);
    assert.match(out.message, /Authentication failed/);
    assert.match(out.message, /logging out and back in/);
  });

  it("redacts generic errors", () => {
    const out = formatSdkError(new Error("CURSOR_API_KEY=secret123 failed"));
    assert.match(out.message, /\<redacted\>/);
    assert.equal(out.rotatable, true);
  });

  it("classifies rotatable vs auth", () => {
    const auth = { code: 16, message: "unauthenticated" };
    assert.equal(isAgentRotatableError(auth), false);
    assert.equal(isAgentRotatableError(new Error("agent dead")), true);
  });
});

describe("consumeRunStream", () => {
  it("invokes handler for each event", async () => {
    const run: RunLike = {
      stream: async function* () {
        yield { type: "text", text: "a" };
        yield { type: "text", text: "b" };
      },
      wait: async () => ({ status: "finished", id: "r1" }),
    };
    const seen: string[] = [];
    await consumeRunStream(run, (ev) => {
      seen.push(String((ev as { text?: string }).text ?? ""));
    });
    assert.deepEqual(seen, ["a", "b"]);
  });

  it("propagates stream errors to caller", async () => {
    const run: RunLike = {
      stream: async function* () {
        yield { type: "text", text: "partial" };
        throw Object.assign(new Error("stream failed"), { code: 16 });
      },
      wait: async () => ({ status: "error" }),
    };
    await assert.rejects(
      () =>
        consumeRunStream(run, () => {
          /* noop */
        }),
      /stream failed/
    );
  });
});

describe("openChatSession sendTurn errors", () => {
  it("returns recoverable auth error instead of throwing", async () => {
    const prev = process.env.CURSOR_API_KEY;
    process.env.CURSOR_API_KEY = "test-key";
    const dir = mkdtempSync(resolve(tmpdir(), "chat-err-"));
    try {
      const authErr = Object.assign(new Error("Error"), {
        code: 16,
        details: [
          {
            debug: {
              error: "ERROR_NOT_LOGGED_IN",
              details: {
                title: "Authentication error",
                detail: "If you are logged in, try logging out and back in.",
              },
            },
          },
        ],
      });
      const sdk: SdkCreateLike = {
        create: async () => ({
          agentId: "a1",
          send: async (): Promise<RunLike> => ({
            stream: async function* () {
              yield { type: "assistant", message: { content: [{ type: "text", text: "x" }] } };
              throw authErr;
            },
            wait: async () => {
              throw authErr;
            },
          }),
        }),
      };
      const opened = await openChatSession({ sdk, dir, interactive: false });
      assert.equal(opened.ok, true);
      const out = await opened.session.sendTurn("hello");
      assert.equal(out.kind, "error");
      if (out.kind === "error") {
        assert.equal(out.fatal, false);
        assert.match(out.message, /Authentication failed/);
      }
      await opened.session.close();
    } finally {
      if (prev === undefined) delete process.env.CURSOR_API_KEY;
      else process.env.CURSOR_API_KEY = prev;
    }
  });
});
