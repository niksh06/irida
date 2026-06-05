import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCronJobPromptText } from "../src/cronPrompt.js";
import type { CronJob } from "../src/cronJobs.js";

test("loadCronJobPromptText reads promptFile relative to config dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "cronprompt-"));
  const prompts = join(dir, "prompts");
  mkdirSync(prompts, { recursive: true });
  writeFileSync(join(prompts, "job.txt"), "digest from file\n");
  const job: CronJob = { id: "digest", cron: "0 9 * * *", promptFile: "prompts/job.txt" };
  const text = loadCronJobPromptText(job, dir);
  assert.equal(text, "digest from file");
});

test("loadCronJobPromptText uses inline prompt", () => {
  const dir = mkdtempSync(join(tmpdir(), "croninline-"));
  const job: CronJob = { id: "inline", cron: "0 9 * * *", prompt: "hello inline" };
  assert.equal(loadCronJobPromptText(job, dir), "hello inline");
});
