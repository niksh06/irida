import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { registerAskMcpTools, type AskMcpContext } from "../src/mcp/askTools.js";
import { getPendingQuestion } from "../src/gatewayPendingQuestionStore.js";
import { listFollowups, FOLLOWUP_MAX_AFTER_MINUTES } from "../src/gatewayFollowupStore.js";

/** Minimal McpServer stand-in: capture registered tool handlers. */
function fakeServer() {
  const handlers: Record<string, (args: any) => Promise<{ content: { type: string; text: string }[] }>> = {};
  const server = {
    registerTool(name: string, _schema: unknown, handler: (args: any) => Promise<any>) {
      handlers[name] = handler;
    },
  };
  return { server: server as any, handlers };
}

function sandbox() {
  // Do NOT set IRIDA_HOME=dir: guardProdStateWrite blocks writes under
  // iridaHome()/.agent during npm test. loadConfig(dir) needs only the
  // agent.config.json we write here.
  const dir = mkdtempSync(resolve(tmpdir(), "ask-tool-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(join(dir, "agent.config.json"), JSON.stringify({ stateDir: ".agent" }) + "\n");
  return { dir, restore: () => {} };
}

test("ask_user parks the question and tells the agent to end its turn", async () => {
  const sb = sandbox();
  try {
    const ctx: AskMcpContext = {
      dir: sb.dir,
      stateDir: join(sb.dir, ".agent"),
      gatewayChatId: "123",
      gatewayAdapter: "telegram",
    };
    const { server, handlers } = fakeServer();
    registerAskMcpTools(server, ctx);
    assert.ok(handlers.ask_user, "ask_user tool registered");

    const res = await handlers.ask_user({ question: "Deploy to prod now?" });
    // persisted to the shared store the gateway reads
    assert.equal(getPendingQuestion(sb.dir, "telegram", "123")?.question, "Deploy to prod now?");
    // result steers the agent to stop and wait (no guessing)
    assert.match(res.content[0]!.text, /END YOUR TURN|do not assume/i);
  } finally {
    sb.restore();
  }
});

test("ask_user outside a gateway chat degrades to inline-ask, parks nothing", async () => {
  const sb = sandbox();
  try {
    const ctx: AskMcpContext = { dir: sb.dir, stateDir: join(sb.dir, ".agent") }; // no gatewayChatId
    const { server, handlers } = fakeServer();
    registerAskMcpTools(server, ctx);

    const res = await handlers.ask_user({ question: "anything?" });
    assert.match(res.content[0]!.text, /only available in gateway chat/i);
    assert.equal(getPendingQuestion(sb.dir, "telegram", "123"), undefined);
  } finally {
    sb.restore();
  }
});

test("defer_followup schedules a follow-up and tells the agent to ack & stop", async () => {
  const sb = sandbox();
  try {
    const ctx: AskMcpContext = {
      dir: sb.dir,
      stateDir: join(sb.dir, ".agent"),
      gatewayChatId: "123",
      gatewayAdapter: "telegram",
    };
    const { server, handlers } = fakeServer();
    registerAskMcpTools(server, ctx);
    assert.ok(handlers.defer_followup, "defer_followup tool registered");

    const res = await handlers.defer_followup({ reason: "check the deploy and report", after_minutes: 10 });
    const items = listFollowups(sb.dir, "telegram", "123");
    assert.equal(items.length, 1);
    assert.equal(items[0]!.reason, "check the deploy and report");
    assert.match(res.content[0]!.text, /END YOUR TURN|ack/i);
  } finally {
    sb.restore();
  }
});

test("defer_followup rejects an out-of-range delay", async () => {
  const sb = sandbox();
  try {
    const ctx: AskMcpContext = {
      dir: sb.dir,
      stateDir: join(sb.dir, ".agent"),
      gatewayChatId: "123",
      gatewayAdapter: "telegram",
    };
    const { server, handlers } = fakeServer();
    registerAskMcpTools(server, ctx);
    const res = await handlers.defer_followup({ reason: "x", after_minutes: FOLLOWUP_MAX_AFTER_MINUTES + 100 });
    assert.match(res.content[0]!.text, /after_minutes/i);
    assert.equal(listFollowups(sb.dir, "telegram", "123").length, 0);
  } finally {
    sb.restore();
  }
});

test("defer_followup outside a gateway chat schedules nothing", async () => {
  const sb = sandbox();
  try {
    const ctx: AskMcpContext = { dir: sb.dir, stateDir: join(sb.dir, ".agent") };
    const { server, handlers } = fakeServer();
    registerAskMcpTools(server, ctx);
    const res = await handlers.defer_followup({ reason: "x", after_minutes: 5 });
    assert.match(res.content[0]!.text, /only available in gateway chat/i);
    assert.equal(listFollowups(sb.dir, "telegram", "123").length, 0);
  } finally {
    sb.restore();
  }
});

test("ask_user trims/guards an empty question", async () => {
  const sb = sandbox();
  try {
    const ctx: AskMcpContext = {
      dir: sb.dir,
      stateDir: join(sb.dir, ".agent"),
      gatewayChatId: "123",
      gatewayAdapter: "telegram",
    };
    const { server, handlers } = fakeServer();
    registerAskMcpTools(server, ctx);

    const res = await handlers.ask_user({ question: "   " });
    assert.match(res.content[0]!.text, /empty question/i);
    assert.equal(getPendingQuestion(sb.dir, "telegram", "123"), undefined);
  } finally {
    sb.restore();
  }
});
