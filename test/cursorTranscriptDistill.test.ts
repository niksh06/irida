import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  cursorLessonNoteName,
  formatDistillQueueMarkdown,
  lessonNeedsRefresh,
  listTranscriptsNeedingDistill,
  parseCursorLessonMeta,
  validateLessonBodySize,
  MAX_LESSON_BODY_BYTES,
} from "../src/cursorTranscriptDistill.js";
import { CURSOR_LESSON_WING, CURSOR_TRANSCRIPT_WING } from "../src/memoryWings.js";
import { createMemoryStore } from "../src/memoryStore.js";

test("cursorLessonNoteName maps cursor.* to lesson.*", () => {
  assert.equal(cursorLessonNoteName("cursor.abc-def"), "lesson.abc-def");
});

test("lessonNeedsRefresh detects missing and stale lessons", () => {
  const archive =
    "<!-- csagent cursor-ide mine; id=x; mtime=2026-06-01T00:00:00.000Z; hash=aaa111 -->";
  assert.deepEqual(lessonNeedsRefresh(archive, undefined, false), {
    needs: true,
    reason: "missing",
    sourceHash: "aaa111",
  });
  const lesson =
    "<!-- csagent cursor-lesson; source=cursor.x; sourceHash=bbb222; status=proposal -->";
  assert.deepEqual(lessonNeedsRefresh(archive, lesson, false), {
    needs: true,
    reason: "stale",
    sourceHash: "aaa111",
  });
  const fresh =
    "<!-- csagent cursor-lesson; source=cursor.x; sourceHash=aaa111; status=proposal -->";
  assert.deepEqual(lessonNeedsRefresh(archive, fresh, false), {
    needs: false,
    sourceHash: "aaa111",
  });
});

test("parseCursorLessonMeta reads source header fields", () => {
  const body =
    "<!-- csagent cursor-lesson; source=cursor.uuid; sourceHash=deadbeef; status=proposal -->\n# Lesson";
  assert.deepEqual(parseCursorLessonMeta(body), {
    source: "cursor.uuid",
    sourceHash: "deadbeef",
    status: "proposal",
  });
});

test("validateLessonBodySize enforces 4 KiB cap", () => {
  assert.equal(validateLessonBodySize("x".repeat(MAX_LESSON_BODY_BYTES)), true);
  assert.equal(validateLessonBodySize("x".repeat(MAX_LESSON_BODY_BYTES + 1)), false);
});

test("listTranscriptsNeedingDistill sorts by body size desc", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "distill-queue-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ model: "m", runtime: "local", cwd: dir, stateDir: ".agent" }),
    "utf8"
  );
  const memory = createMemoryStore(dir);
  try {
    await memory.upsertNote({
      name: "cursor.small",
      wing: CURSOR_TRANSCRIPT_WING,
      title: "small",
      body: "<!-- csagent cursor-ide mine; id=small; mtime=2026-06-01T00:00:00.000Z; hash=111 -->",
    });
    await memory.upsertNote({
      name: "cursor.large",
      wing: CURSOR_TRANSCRIPT_WING,
      title: "large",
      body:
        "<!-- csagent cursor-ide mine; id=large; mtime=2026-06-01T00:00:00.000Z; hash=222 -->\n" +
        "x".repeat(5000),
    });
    await memory.upsertNote({
      name: "lesson.large",
      wing: CURSOR_LESSON_WING,
      title: "done",
      body: "<!-- csagent cursor-lesson; source=cursor.large; sourceHash=222; status=proposal -->",
    });

    const out = await listTranscriptsNeedingDistill(memory, { limit: 5 });
    assert.equal(out.candidates.length, 1);
    assert.equal(out.candidates[0]!.sourceName, "cursor.small");
    assert.equal(out.candidates[0]!.reason, "missing");

    const md = formatDistillQueueMarkdown(out);
    assert.match(md, /cursor\.small/);
    assert.match(md, /Upsert rule/);
  } finally {
    await memory.close();
  }
});

test("listTranscriptsNeedingDistill delta mode skips archives before baseline", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "distill-delta-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ model: "m", runtime: "local", cwd: dir, stateDir: ".agent" }),
    "utf8"
  );
  const memory = createMemoryStore(dir);
  const baseline = { baselineAt: new Date(Date.now() + 86_400_000).toISOString() };
  try {
    await memory.upsertNote({
      name: "cursor.old",
      wing: CURSOR_TRANSCRIPT_WING,
      title: "old",
      body: "<!-- csagent cursor-ide mine; id=old; mtime=2026-06-01T00:00:00.000Z; hash=111 -->",
    });
    await memory.upsertNote({
      name: "cursor.new",
      wing: CURSOR_TRANSCRIPT_WING,
      title: "new",
      body: "<!-- csagent cursor-ide mine; id=new; mtime=2026-06-15T00:00:00.000Z; hash=222 -->",
    });

    const delta = await listTranscriptsNeedingDistill(memory, { limit: 10 }, baseline);
    assert.equal(delta.mode, "delta");
    assert.equal(delta.candidates.length, 0);

    const backfill = await listTranscriptsNeedingDistill(memory, { limit: 10, backfill: true });
    assert.equal(backfill.candidates.length, 2);
  } finally {
    await memory.close();
  }
});
