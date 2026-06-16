import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFileSync } from "node:fs";
import {
  distillOneTranscript,
  runCursorDistillBatch,
  CURSOR_DISTILL_SUBAGENT_MODEL,
} from "../src/cursorTranscriptDistillOrchestrator.js";
import { CURSOR_LESSON_WING, CURSOR_TRANSCRIPT_WING } from "../src/memoryWings.js";
import { createMemoryStore } from "../src/memoryStore.js";
import type { RunOptions, RunResult } from "../src/run.js";
import { EXIT } from "../src/exit.js";

function writeMinimalConfig(dir: string): void {
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ model: "composer-2.5", cwd: dir, runtime: "local" }, null, 2)
  );
}

describe("cursorTranscriptDistillOrchestrator", () => {
  it("uses composer-2.5-fast for subagents", () => {
    assert.equal(CURSOR_DISTILL_SUBAGENT_MODEL, "composer-2.5-fast");
  });

  it("distillOneTranscript saves lesson via mock runFn", async () => {
    const dir = mkdtempSync(join(tmpdir(), "csagent-distill-"));
    writeMinimalConfig(dir);
    const memory = createMemoryStore(dir);
    const header =
      "<!-- csagent cursor-ide mine; id=abc; mtime=2026-01-01T00:00:00.000Z; hash=deadbeefcafebabe -->";
    const body = `${header}\n\n## User\n\nfix gateway\n\n## Assistant\n\ndone`;
    await memory.upsertNote({
      name: "cursor.abc",
      wing: CURSOR_TRANSCRIPT_WING,
      title: "Cursor chat abc",
      body,
    });
    await memory.close();

    const models: string[] = [];
    const runFn = async (prompt: string, opts: RunOptions): Promise<RunResult> => {
      if (opts.model) models.push(opts.model);
      return {
        exitCode: EXIT.ok,
        text: `<!-- csagent cursor-lesson; source=cursor.abc; sourceHash=deadbeefcafebabe; status=proposal -->\n\n# Summary\n- fixed gateway`,
      };
    };

    const { body: lessonBody, chunks } = await distillOneTranscript(
      dir,
      {
        sourceName: "cursor.abc",
        lessonName: "lesson.abc",
        title: "Cursor chat abc",
        bodyBytes: body.length,
        sourceHash: "deadbeefcafebabe",
        reason: "missing",
      },
      body,
      { runFn, parallel: 2 }
    );

    assert.equal(chunks, 1);
    assert.match(lessonBody, /cursor-lesson/);
    assert.match(lessonBody, /Summary/);
    assert.ok(models.every((m) => m === "composer-2.5-fast"));
    rmSync(dir, { recursive: true, force: true });
  });

  it("runCursorDistillBatch dry-run counts chunks without SDK", async () => {
    const dir = mkdtempSync(join(tmpdir(), "csagent-distill-"));
    writeMinimalConfig(dir);
    const memory = createMemoryStore(dir);
    await memory.upsertNote({
      name: "cursor.dry",
      wing: CURSOR_TRANSCRIPT_WING,
      title: "Cursor chat dry",
      body: "## User\n\nhello",
    });
    await memory.close();

    const batch = await runCursorDistillBatch({ dir, limit: 5, backfill: true, dryRun: true });
    assert.equal(batch.processed, 1);
    assert.equal(batch.saved, 0);
    assert.equal(batch.results[0]!.chunks, 1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("runCursorDistillBatch upserts lesson note", async () => {
    const dir = mkdtempSync(join(tmpdir(), "csagent-distill-"));
    writeMinimalConfig(dir);
    const memory = createMemoryStore(dir);
    await memory.upsertNote({
      name: "cursor.save",
      wing: CURSOR_TRANSCRIPT_WING,
      title: "Cursor chat save",
      body: "<!-- csagent cursor-ide mine; id=save; mtime=2026-01-01T00:00:00.000Z; hash=abc123 -->",
    });
    await memory.close();

    const runFn = async (): Promise<RunResult> => ({
      exitCode: EXIT.ok,
      text: `<!-- csagent cursor-lesson; source=cursor.save; sourceHash=abc123; status=proposal -->\n\n# Summary\n- ok`,
    });

    const batch = await runCursorDistillBatch({
      dir,
      limit: 1,
      backfill: true,
      runFn,
    });
    assert.equal(batch.saved, 1);
    const after = createMemoryStore(dir);
    const lesson = await after.getNote("lesson.save");
    await after.close();
    assert.equal(lesson?.wing, CURSOR_LESSON_WING);
    assert.match(lesson?.body ?? "", /Summary/);
    rmSync(dir, { recursive: true, force: true });
  });
});
