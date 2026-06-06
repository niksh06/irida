import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadCronJobs } from "../src/cronJobs.js";

test("cron job accepts topicDelegates without promptFile", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "cron-topic-"));
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
          id: "tparser-daily-digest",
          cron: "59 23 * * *",
          topicDelegates: true,
          topicPromptFile: "deploy/prompts/tparser-daily-topic.prompt.txt",
          synthesizePromptFile: "deploy/prompts/tparser-daily-synthesize.prompt.txt",
        },
      ],
    }),
    "utf8"
  );
  const jobs = loadCronJobs(dir);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.topicDelegates, true);
  assert.ok(jobs[0]!.topicPromptFile?.includes("daily-topic"));
});
