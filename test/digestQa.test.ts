import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  DEFAULT_DIGEST_JOB_ID,
  evaluateDigestQa,
  saveDigestOutput,
} from "../src/digestQa.js";
import { saveCronState } from "../src/cronJobs.js";

function setupDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "digest-qa-"));
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
  return dir;
}

test("evaluateDigestQa passes with healthy lastResult and digest body", () => {
  const dir = setupDir();
  const at = new Date(Date.now() - 2 * 3_600_000).toISOString();
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
        topics: [
          { id: "ai-ml", title: "AI / ML / LLM", ok: true },
          { id: "infosec", title: "InfoSec", ok: true },
        ],
      },
    },
  });
  saveDigestOutput(
    dir,
    DEFAULT_DIGEST_JOB_ID,
    [
      "📬 TParser · день",
      "## AI / ML / LLM",
      "Вердикт агента: ok",
      "https://t.me/example/1",
      "## AISec / MLSec",
      "https://t.me/example/2",
      "## InfoSec / AppSec",
      "https://t.me/example/3",
    ].join("\n")
  );
  const report = evaluateDigestQa(dir, DEFAULT_DIGEST_JOB_ID);
  assert.equal(report.ok, true);
  assert.ok(report.checks.some((c) => c.name === "tg links" && c.ok));
});

test("evaluateDigestQa fails when lastResult missing", () => {
  const dir = setupDir();
  const report = evaluateDigestQa(dir, DEFAULT_DIGEST_JOB_ID);
  assert.equal(report.ok, false);
  assert.ok(report.checks.some((c) => c.name === "last run" && !c.ok));
});

test("evaluateDigestQa accepts empty-day digest", () => {
  const dir = setupDir();
  const at = new Date(Date.now() - 1 * 3_600_000).toISOString();
  saveCronState(dir, {
    version: 1,
    lastRun: {},
    lastResult: {
      [DEFAULT_DIGEST_JOB_ID]: {
        at,
        ok: true,
        durationMs: 120_000,
        message: "empty",
        topicOk: 5,
        topicTotal: 5,
      },
    },
  });
  saveDigestOutput(dir, DEFAULT_DIGEST_JOB_ID, "📬 TParser · день · релевантных постов не было.");
  const report = evaluateDigestQa(dir, DEFAULT_DIGEST_JOB_ID);
  assert.equal(report.ok, true);
});
