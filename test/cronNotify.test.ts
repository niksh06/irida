import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  resolveJobNotify,
  resolveJobNotifyTarget,
  sendCronJobNotify,
  setCronNotifyHook,
  splitTelegramMessages,
  type CronNotifyPayload,
} from "../src/cronNotify.js";
import { saveCronState } from "../src/cronJobs.js";
import { DEFAULT_DIGEST_JOB_ID } from "../src/digestQa.js";
import { loadOutbox } from "../src/gatewayOutbox.js";
import type { CronJob } from "../src/cronJobs.js";

/** Text from sendMessage or sendRichMessage request body. */
function telegramBodyText(body: Record<string, unknown>): string {
  if (typeof body.text === "string") return body.text;
  const rm = body.rich_message;
  if (rm && typeof rm === "object" && rm !== null && "markdown" in rm) {
    return String((rm as { markdown: unknown }).markdown);
  }
  return "";
}

function topicDigestNotifyDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "cron-notify-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ stateDir: ".agent", cwd: dir }),
    "utf8"
  );
  writeFileSync(
    join(dir, ".agent", "cron.jobs.json"),
    JSON.stringify({
      version: 1,
      jobs: [
        {
          id: DEFAULT_DIGEST_JOB_ID,
          cron: "59 23 * * *",
          topicDelegates: true,
          topicPromptFile: "deploy/prompts/tparser-daily-topic.prompt.txt",
          synthesizePromptFile: "deploy/prompts/tparser-daily-synthesize.prompt.txt",
        },
      ],
    }),
    "utf8"
  );
  const at = new Date(Date.now() - 3_600_000).toISOString();
  saveCronState(dir, {
    version: 1,
    lastRun: { [DEFAULT_DIGEST_JOB_ID]: "2026-05-29 23:59" },
    lastResult: {
      [DEFAULT_DIGEST_JOB_ID]: {
        at,
        ok: true,
        durationMs: 600_000,
        message: "finished",
        topicOk: 5,
        topicTotal: 5,
      },
    },
  });
  return dir;
}

test("resolveJobNotify reads job notify block and env fallback", () => {
  const job: CronJob = {
    id: "nightly",
    cron: "0 9 * * *",
    prompt: "x",
    notify: { chatId: "u1", secretEnv: "GATEWAY_WEBHOOK_SECRET" },
  };
  const prev = process.env.CRON_NOTIFY_WEBHOOK_URL;
  process.env.CRON_NOTIFY_WEBHOOK_URL = "http://127.0.0.1:18789/hook";
  const n = resolveJobNotify(job);
  assert.ok(n);
  assert.equal(n!.chatId, "u1");
  assert.match(n!.webhookUrl, /hook/);
  if (prev === undefined) delete process.env.CRON_NOTIFY_WEBHOOK_URL;
  else process.env.CRON_NOTIFY_WEBHOOK_URL = prev;
});

test("sendCronJobNotify uses custom hook", async () => {
  const payloads: CronNotifyPayload[] = [];
  setCronNotifyHook(async (p) => {
    payloads.push(p);
  });
  const job: CronJob = { id: "j", cron: "* * * * *", prompt: "p" };
  await sendCronJobNotify(job, { ok: true, exitCode: 0, message: "done" });
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0]!.jobId, "j");
  setCronNotifyHook(null);
});

test("resolveJobNotifyTarget prefers telegram when telegram:true", () => {
  const job: CronJob = {
    id: "digest",
    cron: "0 */2 * * *",
    prompt: "x",
    notify: { chatId: "123456789", telegram: true },
  };
  const t = resolveJobNotifyTarget(job);
  assert.ok(t);
  assert.equal(t!.mode, "telegram");
  assert.equal(t!.chatId, "123456789");
  assert.equal(resolveJobNotify(job), null);
});

test("splitTelegramMessages chunks long text", () => {
  const long = "a".repeat(5000);
  const parts = splitTelegramMessages(long, 4096);
  assert.ok(parts.length >= 2);
  assert.ok(parts.every((p) => p.length <= 4096));
});

test("sendCronJobNotify sends digest post-mortem for topicDelegates", async () => {
  const dir = topicDigestNotifyDir();
  const posts: Array<Record<string, unknown>> = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    posts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ ok: true, result: {} }));
  };
  const job: CronJob = {
    id: DEFAULT_DIGEST_JOB_ID,
    cron: "59 23 * * *",
    topicDelegates: true,
    notify: { chatId: "123456789", telegram: true, tokenEnv: "TELEGRAM_BOT_TOKEN" },
  };
  const prevToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  const digestBody = [
    "📬 TParser · день",
    "## AI / ML / LLM",
    "https://t.me/example/1",
    "## AISec / MLSec",
    "https://t.me/example/2",
    "## InfoSec / AppSec",
    "https://t.me/example/3",
  ].join("\n");
  await sendCronJobNotify(
    job,
    {
      ok: true,
      exitCode: 0,
      message: "finished",
      output: digestBody,
      durationMs: 90_000,
      topicSummaries: [
        { topicId: "ai-ml", title: "AI/ML", ok: true, summary: "a" },
        { topicId: "devops", title: "DevOps", ok: true, summary: "b" },
      ],
    },
    new Date(),
    dir
  );
  assert.equal(posts.length, 2);
  assert.match(telegramBodyText(posts[0]!), /TParser/);
  assert.match(telegramBodyText(posts[1]!), /post-mortem/);
  globalThis.fetch = prevFetch;
  if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = prevToken;
});

test("sendCronJobNotify sends QA alert when digest body fails checks", async () => {
  const dir = topicDigestNotifyDir();
  const posts: Array<Record<string, unknown>> = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    posts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ ok: true, result: {} }));
  };
  const job: CronJob = {
    id: DEFAULT_DIGEST_JOB_ID,
    cron: "59 23 * * *",
    topicDelegates: true,
    notify: { chatId: "123456789", telegram: true, tokenEnv: "TELEGRAM_BOT_TOKEN" },
  };
  const prevToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  await sendCronJobNotify(
    job,
    {
      ok: true,
      exitCode: 0,
      message: "finished",
      output: "📬 TParser · день\n## AI / ML / LLM\nno links here",
      durationMs: 600_000,
      topicSummaries: [{ topicId: "ai-ml", title: "AI/ML", ok: true, summary: "a" }],
    },
    new Date(),
    dir
  );
  assert.equal(posts.length, 3);
  assert.match(String(posts[2]!.text), /QA FAIL/);
  assert.match(String(posts[2]!.text), /tg links/);
  globalThis.fetch = prevFetch;
  if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = prevToken;
});

test("sendCronJobNotify parks only post-mortem when digest sent but post-mortem fails", async () => {
  const dir = topicDigestNotifyDir();
  let sendCalls = 0;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    sendCalls++;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (sendCalls === 1) {
      assert.match(telegramBodyText(body), /TParser/);
      return new Response(JSON.stringify({ ok: true, result: {} }));
    }
    throw new Error("network blip");
  };
  const job: CronJob = {
    id: DEFAULT_DIGEST_JOB_ID,
    cron: "59 23 * * *",
    topicDelegates: true,
    notify: { chatId: "123456789", telegram: true, tokenEnv: "TELEGRAM_BOT_TOKEN" },
  };
  const prevToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  const digestBody = [
    "📬 TParser · день",
    "## AI / ML / LLM",
    "https://t.me/example/1",
    "## AISec / MLSec",
    "https://t.me/example/2",
    "## InfoSec / AppSec",
    "https://t.me/example/3",
  ].join("\n");
  await sendCronJobNotify(
    job,
    {
      ok: true,
      exitCode: 0,
      message: "finished",
      output: digestBody,
      durationMs: 90_000,
      topicSummaries: [
        { topicId: "ai-ml", title: "AI/ML", ok: true, summary: "a" },
        { topicId: "devops", title: "DevOps", ok: true, summary: "b" },
      ],
    },
    new Date(),
    dir
  );
  assert.equal(sendCalls, 3);
  const outbox = loadOutbox(dir);
  assert.equal(outbox.entries.length, 1);
  assert.match(outbox.entries[0]!.text, /post-mortem/);
  assert.doesNotMatch(outbox.entries[0]!.text, /TParser · день/);
  globalThis.fetch = prevFetch;
  if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = prevToken;
});

test("sendCronJobNotify parks digest and post-mortem when first send fails", async () => {
  const dir = topicDigestNotifyDir();
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  const job: CronJob = {
    id: DEFAULT_DIGEST_JOB_ID,
    cron: "59 23 * * *",
    topicDelegates: true,
    notify: { chatId: "123456789", telegram: true, tokenEnv: "TELEGRAM_BOT_TOKEN" },
  };
  const prevToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  await sendCronJobNotify(
    job,
    {
      ok: true,
      exitCode: 0,
      message: "finished",
      output: "📬 TParser · день\nhttps://t.me/example/1",
      durationMs: 60_000,
      topicSummaries: [{ topicId: "ai-ml", title: "AI/ML", ok: true, summary: "a" }],
    },
    new Date(),
    dir
  );
  const outbox = loadOutbox(dir);
  assert.equal(outbox.entries.length, 2);
  assert.match(outbox.entries[0]!.text, /TParser/);
  assert.match(outbox.entries[1]!.text, /post-mortem/);
  globalThis.fetch = prevFetch;
  if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = prevToken;
});

test("sendCronJobNotify sends digest via telegram API", async () => {
  const posts: Array<Record<string, unknown>> = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    posts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ ok: true, result: {} }));
  };
  const job: CronJob = {
    id: "digest",
    cron: "0 */2 * * *",
    prompt: "x",
    notify: { chatId: "123456789", telegram: true, tokenEnv: "TELEGRAM_BOT_TOKEN" },
  };
  const prevToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  await sendCronJobNotify(
    job,
    { ok: true, exitCode: 0, message: "finished", output: "📬 digest line" },
    new Date(),
    process.cwd()
  );
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.chat_id, "123456789");
  assert.match(telegramBodyText(posts[0]!), /digest/);
  globalThis.fetch = prevFetch;
  if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = prevToken;
});

test("sendCronJobNotify POSTs to webhook", async () => {
  const prevUrl = process.env.CRON_NOTIFY_WEBHOOK_URL;
  const prevSecret = process.env.GATEWAY_WEBHOOK_SECRET;
  process.env.CRON_NOTIFY_WEBHOOK_URL = "http://notify.test/hook";
  process.env.GATEWAY_WEBHOOK_SECRET = "sec";
  let posted: { chatId: string; text: string } | undefined;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    posted = JSON.parse(String(init?.body)) as { chatId: string; text: string };
    return new Response("{}");
  };
  const job: CronJob = {
    id: "job1",
    cron: "* * * * *",
    prompt: "x",
    notify: { chatId: "u1" },
  };
  await sendCronJobNotify(job, { ok: false, exitCode: 70, message: "boom" });
  assert.ok(posted);
  assert.equal(posted!.chatId, "u1");
  assert.match(posted!.text, /FAILED/);
  assert.match(posted!.text, /boom/);
  globalThis.fetch = prevFetch;
  if (prevUrl === undefined) delete process.env.CRON_NOTIFY_WEBHOOK_URL;
  else process.env.CRON_NOTIFY_WEBHOOK_URL = prevUrl;
  if (prevSecret === undefined) delete process.env.GATEWAY_WEBHOOK_SECRET;
  else process.env.GATEWAY_WEBHOOK_SECRET = prevSecret;
});

test("digest QA alert parks to outbox when telegram send fails (I-136)", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "qa-alert-park-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  const { sendDigestQaAlertMessage } = await import("../src/cronNotify.js");
  const job: CronJob = {
    id: DEFAULT_DIGEST_JOB_ID,
    cron: "59 23 * * *",
    topicDelegates: true,
    notify: { chatId: "123456789", telegram: true, tokenEnv: "TELEGRAM_BOT_TOKEN" },
  };
  const report = {
    jobId: DEFAULT_DIGEST_JOB_ID,
    ok: false,
    checks: [{ name: "freshness", ok: false, detail: "200h ago (max 26h)" }],
  };
  const target = resolveJobNotifyTarget(job)!;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: false, description: "Not Found" }), { status: 404 });
  const prevToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  try {
    await sendDigestQaAlertMessage(job, report, dir, target);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prevToken;
  }
  const outbox = loadOutbox(dir);
  assert.equal(outbox.entries.length, 1);
  assert.match(outbox.entries[0]!.text, /QA/i);
  assert.equal(outbox.entries[0]!.chatId, "123456789");
});
