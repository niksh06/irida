import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  processTelegramUpdate,
  telegramGetUpdates,
  telegramSendMessage,
  telegramSendLongMessage,
  telegramSendChatAction,
  startTelegramPoller,
  formatTelegramToolProgressLine,
  formatTelegramMultipartBodies,
  shouldEmitTelegramToolProgress,
  splitTelegramMessages,
  TELEGRAM_MESSAGE_MAX,
} from "../src/gatewayTelegram.js";
import { writeExampleGatewayConfig } from "../src/gateway_cmd.js";
import { GatewaySessionRouter } from "../src/gatewayRouter.js";
import type { SdkLike, SdkCreateLike, SdkResumeLike, RunLike, AgentLike } from "../src/host.js";

function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), "tg-"));
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

function chatAgent(disposed: { v: boolean }, stream?: RunLike["stream"]): AgentLike {
  const defaultStream: RunLike["stream"] = async function* () {
    yield { type: "assistant", message: { content: [{ type: "text", text: "tg:reply" }] } };
  };
  return {
    agentId: "tg-agent",
    send: async (_m: string): Promise<RunLike> => ({
      stream: stream ?? defaultStream,
      wait: async () => ({ status: "finished", id: "run_tg" }),
    }),
    [Symbol.asyncDispose]: async () => {
      disposed.v = true;
    },
  };
}

function mockSdk(disposed: { v: boolean }, stream?: RunLike["stream"]): SdkLike & SdkCreateLike & SdkResumeLike {
  return {
    prompt: async () => ({ status: "finished", result: "x", id: "r", agentId: "a" }),
    create: async () => chatAgent(disposed, stream),
    resume: async () => chatAgent(disposed, stream),
  };
}

test("formatTelegramToolProgressLine uses command preview", () => {
  const line = formatTelegramToolProgressLine({
    label: "shell",
    kind: "tool",
    toolName: "shell",
    command: "npm test",
    phase: "call",
  });
  assert.match(line, /💻 shell: npm test/);
});

test("shouldEmitTelegramToolProgress dedupes in new mode", () => {
  const cfg = {
    telegramShowToolProgress: true,
    telegramToolProgressMode: "new" as const,
  } as import("../src/gatewayConfig.js").GatewayConfig;
  const state = { lastToolName: null, seenCallIds: new Set<string>() };
  const shell = {
    label: "shell",
    kind: "tool" as const,
    toolName: "shell",
    command: "ls",
    phase: "call" as const,
  };
  assert.equal(shouldEmitTelegramToolProgress(cfg, shell, state), true);
  assert.equal(shouldEmitTelegramToolProgress(cfg, shell, state), false);
});

test("processTelegramUpdate routes text to router", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const cfg = writeExampleGatewayConfig(dir, { adapter: "telegram", allowedChatIds: ["42"] });
    const router = new GatewaySessionRouter({ dir, adapter: "telegram", sdk: mockSdk({ v: false }) });
    const out = await processTelegramUpdate(
      cfg,
      router,
      { update_id: 1, message: { message_id: 1, chat: { id: 42 }, text: "hello bot" } },
      { token: "tok" }
    );
    assert.equal(out.handled, true);
    assert.match(out.reply ?? "", /reply/);
    await router.closeAll();
  });
});

test("processTelegramUpdate sends typing and tool progress", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const cfg = writeExampleGatewayConfig(dir, {
      adapter: "telegram",
      allowedChatIds: ["42"],
      telegramShowToolProgress: true,
    });
    const stream: RunLike["stream"] = async function* () {
      yield {
        type: "tool_call",
        name: "shell",
        status: "running",
        call_id: "c1",
        args: { command: "npm test" },
      };
      yield { type: "assistant", message: { content: [{ type: "text", text: "done" }] } };
    };
    const router = new GatewaySessionRouter({ dir, adapter: "telegram", sdk: mockSdk({ v: false }, stream) });
    const calls: string[] = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url.includes("sendChatAction")) {
        return new Response(JSON.stringify({ ok: true }));
      }
      if (url.includes("sendMessage")) {
        const body = JSON.parse(String(init?.body)) as { text: string };
        calls.push(`msg:${body.text}`);
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(JSON.stringify({ ok: false }));
    };
    const out = await processTelegramUpdate(
      cfg,
      router,
      { update_id: 1, message: { message_id: 1, chat: { id: 42 }, text: "run tests" } },
      { token: "tok", fetchFn }
    );
    assert.equal(out.reply, "done");
    assert.ok(calls.some((u) => u.includes("sendChatAction")));
    assert.ok(calls.some((c) => c.includes("shell") && c.includes("npm test")));
    await router.closeAll();
  });
});

test("splitTelegramMessages and formatTelegramMultipartBodies respect limit", () => {
  const long = "a".repeat(5000);
  const parts = splitTelegramMessages(long, TELEGRAM_MESSAGE_MAX);
  assert.ok(parts.length >= 2);
  assert.ok(parts.every((p) => p.length <= TELEGRAM_MESSAGE_MAX));
  const bodies = formatTelegramMultipartBodies(long);
  assert.ok(bodies.length >= 2);
  assert.ok(bodies.every((b) => b.length <= TELEGRAM_MESSAGE_MAX));
  assert.match(bodies[0]!, /^\[1\/\d+\]\n/);
});

test("telegramSendLongMessage posts multiple sendMessage calls", async () => {
  const posts: string[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    if (url.includes("sendMessage")) {
      const body = JSON.parse(String(init?.body)) as { text: string };
      posts.push(body.text);
      return new Response(JSON.stringify({ ok: true }));
    }
    return new Response(JSON.stringify({ ok: false }));
  };
  const n = await telegramSendLongMessage("tok", "42", "b".repeat(5000), fetchFn);
  assert.ok(n >= 2);
  assert.equal(posts.length, n);
  assert.match(posts[0]!, /^\[1\/\d+\]\n/);
});

test("telegramGetUpdates and sendMessage use fetch mock", async () => {
  const calls: string[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.includes("getUpdates")) {
      return new Response(JSON.stringify({ ok: true, result: [] }));
    }
    if (url.includes("sendMessage") || url.includes("sendChatAction")) {
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({ ok: true }));
    }
    return new Response(JSON.stringify({ ok: false }), { status: 500 });
  };
  const updates = await telegramGetUpdates("tok", 0, 1, fetchFn);
  assert.deepEqual(updates, []);
  await telegramSendMessage("tok", "42", "hi", fetchFn);
  await telegramSendChatAction("tok", "42", "typing", fetchFn);
  assert.ok(calls.some((u) => u.includes("getUpdates")));
  assert.ok(calls.some((u) => u.includes("sendMessage")));
  assert.ok(calls.some((u) => u.includes("sendChatAction")));
});

test("startTelegramPoller processes update and replies", async () => {
  await withKey("k", async () => {
    const prev = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const dir = tmp();
    const cfg = writeExampleGatewayConfig(dir, {
      adapter: "telegram",
      allowedChatIds: ["99"],
      telegramPollIntervalMs: 500,
    });
    const disposed = { v: false };
    const router = new GatewaySessionRouter({ dir, adapter: "telegram", sdk: mockSdk(disposed) });
    let pollCount = 0;
    const fetchFn = async (url: string, init?: RequestInit) => {
      if (url.includes("getUpdates")) {
        pollCount++;
        if (pollCount === 1) {
          return new Response(
            JSON.stringify({
              ok: true,
              result: [{ update_id: 7, message: { message_id: 1, chat: { id: 99 }, text: "ping" } }],
            })
          );
        }
        return new Response(JSON.stringify({ ok: true, result: [] }));
      }
      if (url.includes("sendMessage") || url.includes("sendChatAction")) {
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(JSON.stringify({ ok: false }));
    };
    const poller = startTelegramPoller({
      cfg,
      router,
      fetchFn,
      pollIntervalMs: 20,
    });
    await new Promise((r) => setTimeout(r, 80));
    await poller.stop();
    await router.closeAll();
    assert.ok(pollCount >= 1);
    if (prev === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prev;
  });
});

test("startTelegramPoller splits long model replies", async () => {
  await withKey("k", async () => {
    const prev = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const dir = tmp();
    const cfg = writeExampleGatewayConfig(dir, {
      adapter: "telegram",
      allowedChatIds: ["99"],
      telegramPollIntervalMs: 500,
    });
    const longReply = "z".repeat(5000);
    const disposed = { v: false };
    const stream: RunLike["stream"] = async function* () {
      yield { type: "assistant", message: { content: [{ type: "text", text: longReply }] } };
    };
    const router = new GatewaySessionRouter({
      dir,
      adapter: "telegram",
      sdk: mockSdk(disposed, stream),
    });
    const sent: string[] = [];
    let pollCount = 0;
    const fetchFn = async (url: string, init?: RequestInit) => {
      if (url.includes("getUpdates")) {
        pollCount++;
        if (pollCount === 1) {
          return new Response(
            JSON.stringify({
              ok: true,
              result: [{ update_id: 8, message: { message_id: 2, chat: { id: 99 }, text: "long" } }],
            })
          );
        }
        return new Response(JSON.stringify({ ok: true, result: [] }));
      }
      if (url.includes("sendMessage")) {
        const body = JSON.parse(String(init?.body)) as { text: string };
        sent.push(body.text);
        return new Response(JSON.stringify({ ok: true }));
      }
      if (url.includes("sendChatAction")) {
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(JSON.stringify({ ok: false }));
    };
    const poller = startTelegramPoller({
      cfg,
      router,
      fetchFn,
      pollIntervalMs: 20,
    });
    await new Promise((r) => setTimeout(r, 120));
    await poller.stop();
    await router.closeAll();
    assert.ok(sent.length >= 2);
    assert.ok(sent.every((t) => t.length <= TELEGRAM_MESSAGE_MAX));
    assert.match(sent[0]!, /^\[1\/\d+\]\n/);
    if (prev === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prev;
  });
});
