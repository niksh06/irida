import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveJobNotify,
  resolveJobNotifyTarget,
  sendCronJobNotify,
  setCronNotifyHook,
  splitTelegramMessages,
  type CronNotifyPayload,
} from "../src/cronNotify.js";
import type { CronJob } from "../src/cronJobs.js";

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
  assert.match(String(posts[0]!.text), /digest/);
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
