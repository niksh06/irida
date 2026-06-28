import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  setPendingQuestion,
  getPendingQuestion,
  clearPendingQuestion,
  loadPendingQuestions,
  PENDING_QUESTIONS_FILE,
  PENDING_QUESTIONS_MAX,
} from "../src/gatewayPendingQuestionStore.js";

function sandbox() {
  // NOTE: deliberately do NOT set IRIDA_HOME to `dir` — guardProdStateWrite
  // blocks writes under iridaHome()/.agent during `npm test`, and pointing
  // IRIDA_HOME at the sandbox would make its .agent look like prod home.
  // loadConfig(dir) reads dir/agent.config.json directly, no IRIDA_HOME needed.
  const dir = mkdtempSync(resolve(tmpdir(), "gw-pq-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(join(dir, "agent.config.json"), JSON.stringify({ stateDir: ".agent" }) + "\n");
  return {
    dir,
    file: join(dir, ".agent", PENDING_QUESTIONS_FILE),
    restore: () => {},
  };
}

test("set / get / clear a parked question (one per chat)", () => {
  const sb = sandbox();
  try {
    assert.equal(getPendingQuestion(sb.dir, "telegram", "123"), undefined);
    setPendingQuestion(sb.dir, { chatId: "123", adapter: "telegram", question: "Deploy to prod?" });
    const got = getPendingQuestion(sb.dir, "telegram", "123");
    assert.equal(got?.question, "Deploy to prod?");
    // per-chat isolation
    assert.equal(getPendingQuestion(sb.dir, "telegram", "999"), undefined);
    // second ask in the same chat REPLACES the first (one pending per chat)
    setPendingQuestion(sb.dir, { chatId: "123", adapter: "telegram", question: "Which branch?" });
    assert.equal(getPendingQuestion(sb.dir, "telegram", "123")?.question, "Which branch?");
    assert.equal(loadPendingQuestions(sb.dir).pending.length, 1);
    // clear
    assert.equal(clearPendingQuestion(sb.dir, "telegram", "123"), true);
    assert.equal(getPendingQuestion(sb.dir, "telegram", "123"), undefined);
    assert.equal(clearPendingQuestion(sb.dir, "telegram", "123"), false); // already clear
  } finally {
    sb.restore();
  }
});

test("caps the file to PENDING_QUESTIONS_MAX, newest-first (no eviction of the latest)", () => {
  const sb = sandbox();
  try {
    for (let i = 0; i < PENDING_QUESTIONS_MAX + 5; i++) {
      setPendingQuestion(sb.dir, { chatId: `c${i}`, adapter: "telegram", question: `q${i}` });
    }
    const file = loadPendingQuestions(sb.dir);
    assert.equal(file.pending.length, PENDING_QUESTIONS_MAX);
    // the most recent ask must survive; the very first must have been evicted
    const last = PENDING_QUESTIONS_MAX + 4;
    assert.equal(getPendingQuestion(sb.dir, "telegram", `c${last}`)?.question, `q${last}`);
    assert.equal(getPendingQuestion(sb.dir, "telegram", "c0"), undefined);
  } finally {
    sb.restore();
  }
});

test("TTL-expired entries read as absent — never fabricated", () => {
  const sb = sandbox();
  try {
    // hand-write a stale entry (createdAt well past the TTL horizon)
    const stale = {
      version: 1,
      pending: [
        {
          chatId: "123",
          adapter: "telegram",
          question: "old question",
          createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        },
      ],
    };
    writeFileSync(sb.file, JSON.stringify(stale) + "\n");
    assert.equal(getPendingQuestion(sb.dir, "telegram", "123"), undefined);
    assert.equal(loadPendingQuestions(sb.dir).pending.length, 0);
  } finally {
    sb.restore();
  }
});

test("corrupt store file degrades to empty (no throw)", () => {
  const sb = sandbox();
  try {
    writeFileSync(sb.file, "{ not json");
    assert.deepEqual(loadPendingQuestions(sb.dir).pending, []);
    // and a write still recovers
    setPendingQuestion(sb.dir, { chatId: "1", adapter: "telegram", question: "ok?" });
    assert.equal(getPendingQuestion(sb.dir, "telegram", "1")?.question, "ok?");
    assert.match(readFileSync(sb.file, "utf8"), /ok\?/);
  } finally {
    sb.restore();
  }
});
