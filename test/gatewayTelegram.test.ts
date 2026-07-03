import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  assessTelegramAllowedUpdates,
  summarizeTelegramUpdateTypes,
  telegramInboundMessage,
  telegramUpdateChatId,
  processTelegramUpdate,
  resolveTelegramGetUpdatesTimeoutSec,
  telegramGetUpdates,
  telegramSendMessage,
  telegramSendMessageHtml,
  telegramSendFormattedMessage,
  telegramSendLongMessage,
  telegramSendChatAction,
  startTelegramPoller,
  syncTelegramBotCommands,
  formatTelegramToolProgressLine,
  formatTelegramMultipartBodies,
  shouldEmitTelegramToolProgress,
  splitTelegramMessages,
  classifyTelegramChat,
  authorizeTelegramSender,
  isStoreUnavailableError,
  classifyGatewayFailure,
  TELEGRAM_MESSAGE_MAX,
  TELEGRAM_RICH_MESSAGE_MAX,
} from "../src/gatewayTelegram.js";
import type { GatewayConfig } from "../src/gatewayConfig.js";
import { writeExampleGatewayConfig } from "./helpers/gatewayConfig.js";
import { GatewaySessionRouter, GatewayRouterError } from "../src/gatewayRouter.js";
import { GATEWAY_SLASH_COMMANDS } from "../src/gatewaySlash.js";
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

test("syncTelegramBotCommands posts setMyCommands for each scope", async () => {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const fetchFn: import("../src/gatewayTelegram.js").TelegramFetch = async (_url, init) => {
    const url = _url;
    if (url.includes("setMyCommands")) {
      calls.push({
        method: "setMyCommands",
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return new Response(JSON.stringify({ ok: true, result: true }));
    }
    return new Response(JSON.stringify({ ok: false }));
  };
  const n = await syncTelegramBotCommands("tok", fetchFn);
  assert.equal(n, GATEWAY_SLASH_COMMANDS.filter((c) => c.telegram !== false).length);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((c) => (c.body.scope as { type: string }).type), [
    "default",
    "all_private_chats",
    "all_group_chats",
  ]);
  const names = (calls[0]!.body.commands as Array<{ command: string }>).map((c) => c.command);
  // /stop is in the menu since I-138 (queue clear + reply discard).
  assert.ok(
    names.includes("help") && names.includes("doctor") && names.includes("delegate") && names.includes("stop")
  );
});

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

test("processTelegramUpdate ignores edited_message, still routes channel_post (H-12)", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    // Channel posts now require explicit opt-in (allowChannelPosts).
    const cfg = writeExampleGatewayConfig(dir, {
      adapter: "telegram",
      allowedChatIds: ["42", "-1001"],
      telegramAllowChannelPosts: true,
    });
    const router = new GatewaySessionRouter({ dir, adapter: "telegram", sdk: mockSdk({ v: false }) });
    // H-12: an edit of an already-processed message must NOT re-run a turn.
    const edited = await processTelegramUpdate(
      cfg,
      router,
      { update_id: 2, edited_message: { message_id: 2, chat: { id: 42, type: "private" }, text: "edited hello" } },
      { token: "tok" }
    );
    assert.deepEqual(edited, { handled: false });

    const channel = await processTelegramUpdate(
      cfg,
      router,
      { update_id: 3, channel_post: { message_id: 3, chat: { id: -1001, type: "channel" }, text: "channel ping" } },
      { token: "tok" }
    );
    assert.equal(channel.handled, true);
    assert.match(channel.reply ?? "", /reply/);
    await router.closeAll();
  });
});

test("group chat authorizes only allowlisted senders (I-107)", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const cfg = writeExampleGatewayConfig(dir, {
      adapter: "telegram",
      allowedChatIds: ["-500"],
      telegramAllowedSenderIds: ["7001"],
    });
    const router = new GatewaySessionRouter({ dir, adapter: "telegram", sdk: mockSdk({ v: false }) });

    // Allowed sender → routed.
    const ok = await processTelegramUpdate(
      cfg,
      router,
      { update_id: 1, message: { message_id: 1, chat: { id: -500, type: "supergroup" }, from: { id: 7001 }, text: "hi" } },
      { token: "tok" }
    );
    assert.equal(ok.handled, true);
    assert.match(ok.reply ?? "", /reply/);

    // Stranger in the same allowlisted group → silently ignored, no reply.
    const denied = await processTelegramUpdate(
      cfg,
      router,
      { update_id: 2, message: { message_id: 2, chat: { id: -500, type: "supergroup" }, from: { id: 9999 }, text: "rm -rf" } },
      { token: "tok" }
    );
    assert.equal(denied.handled, true);
    assert.equal(denied.reply, undefined);
    assert.equal(denied.error, undefined);
    assert.match(denied.ignored ?? "", /9999/);
    await router.closeAll();
  });
});

test("channel posts ignored unless allowChannelPosts set (I-107)", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const cfg = writeExampleGatewayConfig(dir, { adapter: "telegram", allowedChatIds: ["-700"] });
    const router = new GatewaySessionRouter({ dir, adapter: "telegram", sdk: mockSdk({ v: false }) });
    const out = await processTelegramUpdate(
      cfg,
      router,
      { update_id: 1, channel_post: { message_id: 1, chat: { id: -700, type: "channel" }, text: "post" } },
      { token: "tok" }
    );
    assert.equal(out.handled, true);
    assert.equal(out.reply, undefined);
    assert.match(out.ignored ?? "", /channel posts disabled/);
    await router.closeAll();
  });
});

test("telegramInboundMessage and telegramUpdateChatId cover all inbound types", () => {
  const msg = { message_id: 1, chat: { id: 99 }, text: "x" };
  assert.equal(telegramInboundMessage({ update_id: 1, message: msg })?.chat.id, 99);
  assert.equal(telegramInboundMessage({ update_id: 2, edited_message: msg })?.chat.id, 99);
  assert.equal(telegramInboundMessage({ update_id: 3, channel_post: msg })?.chat.id, 99);
  assert.equal(telegramUpdateChatId({ update_id: 4 }), undefined);
  assert.equal(telegramUpdateChatId({ update_id: 5, message: msg }), "99");
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

test("tool progress: one message sent, later tools edit it (I-37)", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const cfg = writeExampleGatewayConfig(dir, {
      adapter: "telegram",
      allowedChatIds: ["42"],
      telegramShowToolProgress: true,
    });
    const stream: RunLike["stream"] = async function* () {
      yield { type: "tool_call", name: "shell", status: "running", call_id: "c1", args: { command: "ls" } };
      yield { type: "tool_call", name: "read", status: "running", call_id: "c2", args: {} };
      yield { type: "tool_call", name: "grep", status: "running", call_id: "c3", args: {} };
      yield { type: "assistant", message: { content: [{ type: "text", text: "done" }] } };
    };
    const router = new GatewaySessionRouter({ dir, adapter: "telegram", sdk: mockSdk({ v: false }, stream) });
    let sendCount = 0;
    const edits: string[] = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      if (url.includes("editMessageText")) {
        const body = JSON.parse(String(init?.body)) as { text: string; message_id: number };
        edits.push(body.text);
        assert.equal(body.message_id, 777);
        return new Response(JSON.stringify({ ok: true, result: {} }));
      }
      if (url.includes("sendMessage")) {
        sendCount++;
        return new Response(JSON.stringify({ ok: true, result: { message_id: 777 } }));
      }
      return new Response(JSON.stringify({ ok: true, result: {} }));
    };
    const out = await processTelegramUpdate(
      cfg,
      router,
      { update_id: 1, message: { message_id: 1, chat: { id: 42 }, text: "run tools" } },
      { token: "tok", fetchFn, progressEditMinMs: 0 }
    );
    assert.equal(out.reply, "done");
    // One progress message; subsequent tool lines are edits, not new messages.
    assert.equal(sendCount, 1);
    assert.ok(edits.length >= 1);
    assert.ok(edits.some((t) => t.includes("read") || t.includes("grep")));
    await router.closeAll();
  });
});

test("startTelegramPoller fails fast on corrupt bot token (postmortem)", async () => {
  await withKey("k", async () => {
    const prev = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = "garbage"; // 7 chars — the postmortem shape
    const dir = tmp();
    const cfg = writeExampleGatewayConfig(dir, { adapter: "telegram", allowedChatIds: ["42"] });
    const router = new GatewaySessionRouter({ dir, adapter: "telegram", sdk: mockSdk({ v: false }) });
    assert.throws(
      () => startTelegramPoller({ cfg, router, fetchFn: async () => new Response("{}") }),
      /token is invalid.*auth telegram login/s
    );
    await router.closeAll();
    if (prev === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prev;
  });
});

test("telegramSendMessageHtml falls back to plain on parse error", async () => {
  const posts: Array<{ text: string; parse_mode?: string }> = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    if (url.includes("sendMessage")) {
      const body = JSON.parse(String(init?.body)) as { text: string; parse_mode?: string };
      posts.push(body);
      if (body.parse_mode === "HTML") {
        return new Response(JSON.stringify({ ok: false, description: "can't parse entities" }));
      }
      return new Response(JSON.stringify({ ok: true, result: {} }));
    }
    return new Response(JSON.stringify({ ok: false }));
  };
  await telegramSendMessageHtml("tok", "42", "**bold** broken", fetchFn);
  assert.equal(posts.length, 2);
  assert.equal(posts[0]!.parse_mode, "HTML");
  assert.match(posts[0]!.text, /<b>bold<\/b>/);
  assert.equal(posts[1]!.parse_mode, undefined);
  assert.equal(posts[1]!.text, "**bold** broken");
});

test("telegramSendFormattedMessage prefers sendRichMessage, falls back to HTML", async () => {
  const methods: string[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    const method = url.split("/").pop()?.split("?")[0] ?? "";
    methods.push(method);
    if (method === "sendRichMessage") {
      return new Response(JSON.stringify({ ok: false, description: "method not found" }));
    }
    if (method === "sendMessage") {
      const body = JSON.parse(String(init?.body)) as { parse_mode?: string; text: string };
      assert.equal(body.parse_mode, "HTML");
      assert.match(body.text, /<b>hi<\/b>/);
      return new Response(JSON.stringify({ ok: true, result: {} }));
    }
    return new Response(JSON.stringify({ ok: false }));
  };
  await telegramSendFormattedMessage("tok", "42", "**hi**", fetchFn, "rich");
  assert.deepEqual(methods, ["sendRichMessage", "sendMessage"]);
});

test("telegramSendFormattedMessage uses sendRichMessage when supported", async () => {
  let payload: Record<string, unknown> | null = null;
  const fetchFn = async (url: string, init?: RequestInit) => {
    if (url.includes("sendRichMessage")) {
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ ok: true, result: {} }));
    }
    return new Response(JSON.stringify({ ok: false }));
  };
  await telegramSendFormattedMessage("tok", "42", "# Title\n\n- item", fetchFn, "rich");
  assert.ok(payload);
  const rm = (payload as { rich_message?: { markdown?: string } }).rich_message;
  assert.equal(rm?.markdown, "# Title\n\n- item");
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

test("telegramSendLongMessage rich fallback splits at 4096 when sendRichMessage fails", async () => {
  const posts: string[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    if (url.includes("sendRichMessage")) {
      return new Response(
        JSON.stringify({ ok: false, description: "Bad Request: message is too long" })
      );
    }
    if (url.includes("sendMessage")) {
      const body = JSON.parse(String(init?.body)) as { text: string };
      posts.push(body.text);
      return new Response(JSON.stringify({ ok: true }));
    }
    return new Response(JSON.stringify({ ok: false }));
  };
  const text = "x".repeat(5408);
  const n = await telegramSendLongMessage("tok", "42", text, fetchFn, { format: "rich" });
  assert.ok(n >= 2);
  assert.equal(posts.length, n);
  assert.ok(posts.every((p) => p.length <= TELEGRAM_MESSAGE_MAX));
  assert.match(posts[0]!, /^\[1\/\d+\]\n/);
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

test("resolveTelegramGetUpdatesTimeoutSec uses short poll for VPN reliability", () => {
  assert.equal(resolveTelegramGetUpdatesTimeoutSec(500), 0);
  assert.equal(resolveTelegramGetUpdatesTimeoutSec(1500), 0);
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
  const getUrl = calls.find((u) => u.includes("getUpdates")) ?? "";
  assert.match(decodeURIComponent(getUrl), /allowed_updates=.*message/);
  await telegramSendMessage("tok", "42", "hi", fetchFn);
  await telegramSendChatAction("tok", "42", "typing", fetchFn);
  assert.ok(calls.some((u) => u.includes("getUpdates")));
  assert.ok(calls.some((u) => u.includes("sendMessage")));
  assert.ok(calls.some((u) => u.includes("sendChatAction")));
});

test("startTelegramPoller processes update and replies", async () => {
  await withKey("k", async () => {
    const prev = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = "1234567890:TESTTOKENTESTTOKENTESTTOKENTESTTOKE";
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
    process.env.TELEGRAM_BOT_TOKEN = "1234567890:TESTTOKENTESTTOKENTESTTOKENTESTTOKE";
    const dir = tmp();
    const cfg = writeExampleGatewayConfig(dir, {
      adapter: "telegram",
      allowedChatIds: ["99"],
      telegramPollIntervalMs: 500,
    });
    const longReply = "z".repeat(TELEGRAM_RICH_MESSAGE_MAX + 500);
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
      if (url.includes("sendRichMessage") || url.includes("sendMessage")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        if (typeof body.text === "string") sent.push(body.text);
        else if (body.rich_message && typeof body.rich_message === "object") {
          sent.push(String((body.rich_message as { markdown?: string }).markdown ?? ""));
        }
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
    assert.ok(sent.every((t) => t.length <= TELEGRAM_RICH_MESSAGE_MAX));
    assert.match(sent[0]!, /^\[1\/\d+\]\n/);
    if (prev === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prev;
  });
});

test("assessTelegramAllowedUpdates fails when message missing", async () => {
  const fetchFn: import("../src/gatewayTelegram.js").TelegramFetch = async (url) => {
    if (url.includes("getWebhookInfo")) {
      return new Response(
        JSON.stringify({ ok: true, result: { allowed_updates: ["channel_post"] } })
      );
    }
    return new Response(JSON.stringify({ ok: false }));
  };
  const a = await assessTelegramAllowedUpdates("tok", fetchFn);
  assert.equal(a.ok, false);
  assert.match(a.detail, /missing message/);
});

test("assessTelegramAllowedUpdates passes when message present", async () => {
  const fetchFn: import("../src/gatewayTelegram.js").TelegramFetch = async (url) => {
    if (url.includes("getWebhookInfo")) {
      return new Response(
        JSON.stringify({ ok: true, result: { allowed_updates: ["message", "channel_post"] } })
      );
    }
    return new Response(JSON.stringify({ ok: false }));
  };
  const a = await assessTelegramAllowedUpdates("tok", fetchFn);
  assert.equal(a.ok, true);
});

test("classifyTelegramChat uses chat.type then id sign", () => {
  assert.equal(classifyTelegramChat({ message_id: 1, chat: { id: 5, type: "private" } }), "private");
  assert.equal(classifyTelegramChat({ message_id: 1, chat: { id: -5, type: "supergroup" } }), "group");
  assert.equal(classifyTelegramChat({ message_id: 1, chat: { id: -5, type: "channel" } }), "channel");
  // type absent → id sign heuristic
  assert.equal(classifyTelegramChat({ message_id: 1, chat: { id: 5 } }), "private");
  assert.equal(classifyTelegramChat({ message_id: 1, chat: { id: -5 } }), "group");
});

test("authorizeTelegramSender enforces per-chat-kind policy (I-107)", () => {
  const base = {
    telegramAllowedSenderIds: ["100"],
    telegramAllowChannelPosts: false,
  } as unknown as GatewayConfig;

  // Private: always ok.
  assert.equal(authorizeTelegramSender(base, { message_id: 1, chat: { id: 9, type: "private" } }).ok, true);

  // Group: only listed sender, bots rejected.
  assert.equal(
    authorizeTelegramSender(base, { message_id: 1, chat: { id: -9, type: "group" }, from: { id: 100 } }).ok,
    true
  );
  assert.equal(
    authorizeTelegramSender(base, { message_id: 1, chat: { id: -9, type: "group" }, from: { id: 200 } }).ok,
    false
  );
  assert.equal(
    authorizeTelegramSender(base, { message_id: 1, chat: { id: -9, type: "group" }, from: { id: 100, is_bot: true } }).ok,
    false
  );
  // Group without a sender (anon admin) → denied.
  assert.equal(authorizeTelegramSender(base, { message_id: 1, chat: { id: -9, type: "group" } }).ok, false);

  // Channel: gated by allowChannelPosts.
  assert.equal(authorizeTelegramSender(base, { message_id: 1, chat: { id: -9, type: "channel" } }).ok, false);
  const chanOk = { ...base, telegramAllowChannelPosts: true } as GatewayConfig;
  assert.equal(authorizeTelegramSender(chanOk, { message_id: 1, chat: { id: -9, type: "channel" } }).ok, true);
});

test("isStoreUnavailableError detects connection/store outages", () => {
  assert.equal(isStoreUnavailableError("connect ECONNREFUSED 127.0.0.1:5435"), true);
  assert.equal(isStoreUnavailableError("read ECONNRESET"), true);
  assert.equal(isStoreUnavailableError("Connection terminated unexpectedly"), true);
  assert.equal(isStoreUnavailableError("the database system is starting up"), true);
  // Not a store outage:
  assert.equal(isStoreUnavailableError("skill 'memory-ops' not found"), false);
  assert.equal(isStoreUnavailableError("blocked: destructive action"), false);
});

test("classifyGatewayFailure maps errors to typed kinds", () => {
  // Router busy is carried by a typed code, not the message text.
  assert.equal(
    classifyGatewayFailure(new GatewayRouterError("peer busy — previous turn still running", "busy")),
    "busy"
  );
  // A blocked turn is not "busy" — falls through to internal.
  assert.equal(classifyGatewayFailure(new GatewayRouterError("blocked: rm -rf", "blocked")), "internal");
  assert.equal(
    classifyGatewayFailure(new Error("connect ECONNREFUSED 127.0.0.1:5435")),
    "store-unavailable"
  );
  assert.equal(classifyGatewayFailure(new Error("chat not allowed")), "chat-not-allowed");
  assert.equal(classifyGatewayFailure(new Error("kaboom")), "internal");
});

test("summarizeTelegramUpdateTypes counts batch types", () => {
  assert.equal(
    summarizeTelegramUpdateTypes([
      { update_id: 1, message: { message_id: 1, chat: { id: 1 }, text: "hi" } },
      { update_id: 2, channel_post: { message_id: 2, chat: { id: -100 }, text: "." } },
    ]),
    "message:1,channel_post:1"
  );
});
