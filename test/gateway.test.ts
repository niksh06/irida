import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  loadGatewayConfig,
  isChatAllowed,
  gatewayWebhookSecret,
  validateGatewayConfig,
} from "../src/gatewayConfig.js";
import {
  GatewaySessionRouter,
  loadGatewayPeers,
  peerKey,
} from "../src/gatewayRouter.js";
import { dispatchWebhookRequest, parseWebhookBody, webhookAuthOk } from "../src/gatewayWebhook.js";
import { setPendingQuestion, getPendingQuestion } from "../src/gatewayPendingQuestionStore.js";
import { addFollowup, listFollowups } from "../src/gatewayFollowupStore.js";
import { savePairingFile } from "../src/gatewayPairing.js";
import { startGateway } from "../src/gateway_cmd.js";
import { writeExampleGatewayConfig } from "./helpers/gatewayConfig.js";
import { Store } from "../src/store.js";
import type { SdkLike, SdkCreateLike, SdkResumeLike, RunLike, AgentLike } from "../src/host.js";

function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), "gw-"));
}

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function withKey<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  return withEnv({ CURSOR_API_KEY: value }, fn);
}

function chatAgent(disposed: { v: boolean }, agentId = "agent_gw"): AgentLike {
  return {
    agentId,
    send: async (m: string): Promise<RunLike> => ({
      stream: async function* () {
        yield { type: "assistant", message: { content: [{ type: "text", text: `reply:${m}` }] } };
      },
      wait: async () => ({ status: "finished", id: "run_gw" }),
    }),
    [Symbol.asyncDispose]: async () => {
      disposed.v = true;
    },
  };
}

function mockSdk(disposed: { v: boolean }): SdkLike & SdkCreateLike & SdkResumeLike {
  return {
    prompt: async () => ({ status: "finished", result: "noop", id: "r", agentId: "a" }),
    create: async () => chatAgent(disposed),
    resume: async (id: string) => chatAgent(disposed, id),
  };
}

test("parseWebhookBody requires chatId and text", () => {
  assert.deepEqual(parseWebhookBody('{"chatId":"u1","text":"hi"}'), { chatId: "u1", text: "hi" });
  assert.throws(() => parseWebhookBody("{}"), /chatId/);
});

test("webhookAuthOk accepts header or bearer", () => {
  const req = { headers: { "x-gateway-secret": "sec" } } as import("node:http").IncomingMessage;
  assert.equal(webhookAuthOk(req, "sec"), true);
  const bearer = { headers: { authorization: "Bearer sec" } } as import("node:http").IncomingMessage;
  assert.equal(webhookAuthOk(bearer, "sec"), true);
});

test("loadGatewayConfig and allowlist", async () => {
  await withEnv({ GATEWAY_WEBHOOK_SECRET: "s" }, async () => {
    const dir = tmp();
    writeExampleGatewayConfig(dir, { allowedChatIds: ["u1", "dev"] });
    const cfg = loadGatewayConfig(dir);
    assert.equal(cfg.adapter, "webhook");
    assert.ok(isChatAllowed(cfg, "u1"));
    assert.ok(!isChatAllowed(cfg, "stranger"));
    assert.equal(gatewayWebhookSecret(cfg), "s");
    assert.deepEqual(validateGatewayConfig(dir), []);
  });
});

test("validateGatewayConfig warns on group/channel id without sender policy (I-107)", async () => {
  await withEnv({ TELEGRAM_BOT_TOKEN: "t" }, async () => {
    const dir = tmp();
    // Negative id (group/channel), no allowedSenderIds / allowChannelPosts → warn.
    writeExampleGatewayConfig(dir, { adapter: "telegram", allowedChatIds: ["-1001"] });
    const issues = validateGatewayConfig(dir);
    assert.equal(issues.length, 1);
    assert.match(issues[0]!, /-1001/);
    assert.match(issues[0]!, /sender policy/);

    // With a sender policy → clean.
    writeExampleGatewayConfig(dir, {
      adapter: "telegram",
      allowedChatIds: ["-1001"],
      telegramAllowedSenderIds: ["7001"],
    });
    assert.deepEqual(validateGatewayConfig(dir), []);
  });
});

test("GatewaySessionRouter maps peer to stable sess_", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const disposed = { v: false };
    const router = new GatewaySessionRouter({ dir, adapter: "webhook", sdk: mockSdk(disposed) });
    const out = await router.handleInbound("u1", "hello gateway");
    assert.match(out.reply, /hello gateway/);
    const peers = loadGatewayPeers(dir);
    const key = peerKey("webhook", "u1");
    assert.ok(peers.peers[key]?.startsWith("sess_"));
    const store = new Store(dir, ".agent");
    assert.ok(await store.getSession(peers.peers[key]!));
    await store.close();
    await router.closeAll();
    assert.equal(disposed.v, true);
  });
});

test("GatewaySessionRouter maps digest follow-up to expanded prompt", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const router = new GatewaySessionRouter({ dir, adapter: "telegram", sdk: mockSdk({ v: false }) });
    const out = await router.handleInbound("u1", "топ-50");
    assert.match(out.reply, /\[digest-followup\]/);
    assert.match(out.reply, /top-50/);
    await router.closeAll();
  });
});

test("GatewaySessionRouter injects digest context on follow-up when saved", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    mkdirSync(join(dir, ".agent"), { recursive: true });
    writeFileSync(
      join(dir, "agent.config.json"),
      JSON.stringify({ stateDir: ".agent", cwd: dir }),
      "utf8"
    );
    writeFileSync(
      join(dir, ".agent", "cron.last-digest.tparser-daily-digest.txt"),
      "📬 TParser saved digest snippet",
      "utf8"
    );
    const router = new GatewaySessionRouter({
      dir,
      adapter: "telegram",
      sdk: mockSdk({ v: false }),
    });
    const out = await router.handleInbound("u1", "только infosec");
    assert.match(out.reply, /\[digest-context\]/);
    assert.match(out.reply, /TParser saved/);
    assert.match(out.reply, /\[digest-followup\]/);
    await router.closeAll();
  });
});

test("GatewaySessionRouter /new resets peer to fresh sess_", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const router = new GatewaySessionRouter({ dir, adapter: "telegram", sdk: mockSdk({ v: false }) });
    await router.handleInbound("u1", "hello");
    const first = loadGatewayPeers(dir).peers[peerKey("telegram", "u1")];
    assert.ok(first?.startsWith("sess_"));
    const out = await router.handleInbound("u1", "/new");
    assert.match(out.reply, /Новая сессия irida/);
    const second = loadGatewayPeers(dir).peers[peerKey("telegram", "u1")];
    assert.ok(second?.startsWith("sess_"));
    assert.notEqual(first, second);
    await router.closeAll();
  });
});

test("GatewaySessionRouter clears a parked question when the user answers (I-125)", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const router = new GatewaySessionRouter({ dir, adapter: "telegram", sdk: mockSdk({ v: false }) });
    setPendingQuestion(dir, { chatId: "u1", adapter: "telegram", question: "Which env?" });
    assert.ok(getPendingQuestion(dir, "telegram", "u1"));
    // the next normal message is the answer → pending dropped, turn still runs
    const out = await router.handleInbound("u1", "production");
    assert.match(out.reply, /production/);
    assert.equal(getPendingQuestion(dir, "telegram", "u1"), undefined);
    await router.closeAll();
  });
});

test("/cancel abandons a parked question without running a turn (I-125)", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const router = new GatewaySessionRouter({ dir, adapter: "telegram", sdk: mockSdk({ v: false }) });
    setPendingQuestion(dir, { chatId: "u1", adapter: "telegram", question: "Which env?" });
    const out = await router.handleInbound("u1", "/cancel");
    assert.match(out.reply, /Снял ожидание/);
    assert.equal(getPendingQuestion(dir, "telegram", "u1"), undefined);
    // /cancel on an empty state is a clean no-op message
    const again = await router.handleInbound("u1", "/cancel");
    assert.match(again.reply, /Нет ожидающего/);
    await router.closeAll();
  });
});

test("/followups lists, /cancel <fu_id> drops a deferred follow-up (I-126)", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const router = new GatewaySessionRouter({ dir, adapter: "telegram", sdk: mockSdk({ v: false }) });
    const r = addFollowup(dir, { chatId: "u1", adapter: "telegram", reason: "report the build", afterMinutes: 30 });
    const id = r.followup!.id;

    const list = await router.handleInbound("u1", "/followups");
    assert.match(list.reply, new RegExp(id));
    assert.match(list.reply, /report the build/);

    const cancel = await router.handleInbound("u1", `/cancel ${id}`);
    assert.match(cancel.reply, /Отменил отложенную задачу/);
    assert.equal(listFollowups(dir, "telegram", "u1").length, 0);

    const empty = await router.handleInbound("u1", "/followups");
    assert.match(empty.reply, /Нет отложенных задач/);
    await router.closeAll();
  });
});

test("dispatchWebhookRequest end-to-end with mocked SDK", async () => {
  await withKey("k", async () => {
    await withEnv({ GATEWAY_WEBHOOK_SECRET: "test-secret" }, async () => {
      const dir = tmp();
      const cfg = writeExampleGatewayConfig(dir);
      const disposed = { v: false };
      const router = new GatewaySessionRouter({ dir, adapter: cfg.adapter, sdk: mockSdk(disposed) });
      const res = await dispatchWebhookRequest(cfg, router, {
        body: JSON.stringify({ chatId: "u1", text: "ping" }),
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.match(String(res.body.reply), /ping/);
      await router.closeAll();
    });
  });
});

test("dispatchWebhookRequest denies unknown chatId", async () => {
  await withKey("k", async () => {
    await withEnv({ GATEWAY_WEBHOOK_SECRET: "test-secret" }, async () => {
      const dir = tmp();
      const cfg = writeExampleGatewayConfig(dir);
      const router = new GatewaySessionRouter({ dir, adapter: cfg.adapter, sdk: mockSdk({ v: false }) });
      const res = await dispatchWebhookRequest(cfg, router, {
        body: JSON.stringify({ chatId: "evil", text: "hi" }),
        dir,
      });
      assert.equal(res.status, 403);
      await router.closeAll();
    });
  });
});

test("dispatchWebhookRequest allows pairing-approved chatId (same auth as telegram)", async () => {
  await withKey("k", async () => {
    await withEnv({ GATEWAY_WEBHOOK_SECRET: "test-secret" }, async () => {
      const dir = tmp();
      const cfg = writeExampleGatewayConfig(dir);
      savePairingFile(dir, { version: 1, approved: ["paired-1"], pending: [] });
      const disposed = { v: false };
      const router = new GatewaySessionRouter({ dir, adapter: cfg.adapter, sdk: mockSdk(disposed) });
      const res = await dispatchWebhookRequest(cfg, router, {
        body: JSON.stringify({ chatId: "paired-1", text: "ping" }),
        dir,
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      await router.closeAll();
    });
  });
});

test("startGateway binds port and closes cleanly", async () => {
  await withKey("k", async () => {
    await withEnv({ GATEWAY_WEBHOOK_SECRET: "test-secret" }, async () => {
      const dir = tmp();
      writeExampleGatewayConfig(dir, { port: 0 });
      const cfgFile = loadGatewayConfig(dir);
      const disposed = { v: false };
      const handle = await startGateway({ dir, port: 0, sdk: mockSdk(disposed) });
      assert.ok(handle.webhook);
      const port = (handle.webhook!.server.address() as { port: number }).port;
      assert.ok(port > 0);
      const res = await fetch(`http://127.0.0.1:${port}${cfgFile.webhookPath}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Gateway-Secret": "test-secret",
        },
        body: JSON.stringify({ chatId: "u1", text: "via fetch" }),
      });
      const body = (await res.json()) as { ok: boolean; reply: string };
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      assert.match(body.reply, /via fetch/);
      await handle.close();
      assert.equal(disposed.v, true);
    });
  });
});

test("startGateway accepts claude account mode without a Cursor credential", async () => {
  await withEnv(
    {
      CURSOR_API_KEY: undefined,
      ANTHROPIC_API_KEY: undefined,
      CLAUDE_CODE_OAUTH_TOKEN: undefined,
      IRIDA_DATABASE_URL: undefined,
      CSAGENT_DATABASE_URL: undefined,
      IRIDA_HOME: undefined,
      CSAGENT_HOME: undefined,
      GATEWAY_WEBHOOK_SECRET: "test-secret",
    },
    async () => {
      const dir = tmp();
      writeFileSync(
        resolve(dir, "agent.config.json"),
        JSON.stringify({
          stateDir: ".agent",
          cwd: dir,
          engine: { provider: "claude-agent", auth: "account" },
        })
      );
      const cfg = writeExampleGatewayConfig(dir, { port: 0 });
      const handle = await startGateway({ dir, port: 0, sdk: mockSdk({ v: false }) });
      try {
        const port = (handle.webhook!.server.address() as { port: number }).port;
        const res = await fetch(`http://127.0.0.1:${port}${cfg.webhookPath}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Gateway-Secret": "test-secret",
          },
          body: JSON.stringify({ chatId: "u1", text: "claude account turn" }),
        });
        const body = (await res.json()) as { ok: boolean; reply: string };
        assert.equal(res.status, 200);
        assert.equal(body.ok, true);
        assert.match(body.reply, /claude account turn/);
      } finally {
        await handle.close();
      }
    }
  );
});

test("startGateway defers a missing Cursor credential to the peer session", async () => {
  await withEnv(
    {
      CURSOR_API_KEY: undefined,
      IRIDA_DATABASE_URL: undefined,
      CSAGENT_DATABASE_URL: undefined,
      IRIDA_HOME: undefined,
      CSAGENT_HOME: undefined,
      GATEWAY_WEBHOOK_SECRET: "test-secret",
    },
    async () => {
      const dir = tmp();
      writeFileSync(
        resolve(dir, "agent.config.json"),
        JSON.stringify({ stateDir: ".agent", cwd: dir, engine: { provider: "cursor" } })
      );
      writeExampleGatewayConfig(dir, { port: 0 });
      const handle = await startGateway({ dir, port: 0, sdk: mockSdk({ v: false }) });
      try {
        await assert.rejects(handle.router.handleInbound("u1", "cursor turn"), /Set CURSOR_API_KEY/);
      } finally {
        await handle.close();
      }
    }
  );
});

test("doctor flags empty allowlist when gateway.json exists", async () => {
  await withEnv({ GATEWAY_WEBHOOK_SECRET: "s" }, async () => {
    const dir = tmp();
    writeExampleGatewayConfig(dir, { allowedChatIds: [] });
    const { gatherDoctorChecks } = await import("../src/doctorChecks.js");
    const checks = gatherDoctorChecks(dir);
    const gw = checks.find((c) => c.name === "gateway");
    assert.ok(gw);
    assert.equal(gw!.ok, false);
  });
});
