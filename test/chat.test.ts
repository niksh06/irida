import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { cmdChat } from "../src/chat.js";
import { Store } from "../src/store.js";
import type { SdkCreateLike, RunLike } from "../src/host.js";

function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), "chat-"));
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

function makeSdk(opts: { status?: string; disposed: { v: boolean } }): SdkCreateLike {
  return {
    create: async () => ({
      agentId: "a1",
      send: async (msg: string): Promise<RunLike> => ({
        stream: async function* () {
          yield { type: "assistant", message: { content: [{ type: "text", text: `echo:${msg}` }] } };
        },
        wait: async () => ({ status: opts.status ?? "finished", id: "r_" + msg }),
      }),
      [Symbol.asyncDispose]: async () => {
        opts.disposed.v = true;
      },
    }),
  };
}

test("two-turn chat streams, persists, disposes", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const disposed = { v: false };
    let out = "";
    const code = await cmdChat({
      sdk: makeSdk({ disposed }),
      dir,
      lines: ["hi", "more", "exit"],
      interactive: false,
      write: (s) => {
        out += s;
      },
    });
    assert.equal(code, 0);
    assert.match(out, /echo:hi/);
    assert.match(out, /echo:more/);
    assert.equal(disposed.v, true);
    const store = new Store(dir, ".agent");
    const sess = store.listSessions();
    assert.equal(sess.length, 1);
    assert.equal(store.listRuns(sess[0].id).length, 2);
    store.close();
  });
});

test("error run status -> exit 2 and disposed", async () => {
  await withKey("k", async () => {
    const disposed = { v: false };
    const code = await cmdChat({
      sdk: makeSdk({ status: "error", disposed }),
      dir: tmp(),
      lines: ["do it", "exit"],
      interactive: false,
      write: () => {},
    });
    assert.equal(code, 2);
    assert.equal(disposed.v, true);
  });
});

test("destructive prompt non-interactive -> exit 3", async () => {
  await withKey("k", async () => {
    const disposed = { v: false };
    const code = await cmdChat({
      sdk: makeSdk({ disposed }),
      dir: tmp(),
      lines: ["rm -rf /"],
      interactive: false,
      write: () => {},
    });
    assert.equal(code, 3);
  });
});

test("missing API key -> exit 1", async () => {
  await withKey(undefined, async () => {
    const code = await cmdChat({ dir: tmp(), lines: ["hi", "exit"], interactive: false, write: () => {} });
    assert.equal(code, 1);
  });
});
