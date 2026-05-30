import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveJobNotify,
  sendCronJobNotify,
  setCronNotifyHook,
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
