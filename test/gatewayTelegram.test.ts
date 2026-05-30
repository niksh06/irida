import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  processTelegramUpdate,
  telegramGetUpdates,
  telegramSendMessage,
  startTelegramPoller,
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

function chatAgent(disposed: { v: boolean }): AgentLike {
  return {
    agentId: "tg-agent",
    send: async (m: string): Promise<RunLike> => ({
      stream: async function* () {
        yield { type: "assistant", message: { content: [{ type: "text", text: `tg:${m}` }] } };
      },
      wait: async () => ({ status: "finished", id: "run_tg" }),
    }),
    [Symbol.asyncDispose]: async () => {
      disposed.v = true;
    },
  };
}

function mockSdk(disposed: { v: boolean }): SdkLike & SdkCreateLike & SdkResumeLike {
  return {
    prompt: async () => ({ status: "finished", result: "x", id: "r", agentId: "a" }),
    create: async () => chatAgent(disposed),
    resume: async () => chatAgent(disposed),
  };
}

test("processTelegramUpdate routes text to router", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const cfg = writeExampleGatewayConfig(dir, { adapter: "telegram", allowedChatIds: ["42"] });
    const router = new GatewaySessionRouter({ dir, adapter: "telegram", sdk: mockSdk({ v: false }) });
    const out = await processTelegramUpdate(cfg, router, {
      update_id: 1,
      message: { message_id: 1, chat: { id: 42 }, text: "hello bot" },
    });
    assert.equal(out.handled, true);
    assert.match(out.reply ?? "", /hello bot/);
    await router.closeAll();
  });
});

test("telegramGetUpdates and sendMessage use fetch mock", async () => {
  const calls: string[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.includes("getUpdates")) {
      return new Response(JSON.stringify({ ok: true, result: [] }));
    }
    if (url.includes("sendMessage")) {
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({ ok: true }));
    }
    return new Response(JSON.stringify({ ok: false }), { status: 500 });
  };
  const updates = await telegramGetUpdates("tok", 0, 1, fetchFn);
  assert.deepEqual(updates, []);
  await telegramSendMessage("tok", "42", "hi", fetchFn);
  assert.ok(calls.some((u) => u.includes("getUpdates")));
  assert.ok(calls.some((u) => u.includes("sendMessage")));
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
      if (url.includes("sendMessage")) {
        const body = JSON.parse(String(init?.body)) as { text: string };
        assert.match(body.text, /ping/);
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
