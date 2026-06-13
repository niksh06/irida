import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  cursorTranscriptNoteName,
  discoverCursorTranscriptFiles,
  formatCursorTranscriptMarkdown,
  mineCursorTranscriptFile,
} from "../src/cursorTranscriptMine.js";
import { createMemoryStore } from "../src/memoryStore.js";

// parseTranscriptLines is not exported — test via format/markdown with inline helper
function parseLines(raw: string) {
  const lines: Array<{ role: string; text: string }> = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const row = JSON.parse(trimmed) as {
      role?: string;
      message?: { content?: Array<{ type?: string; text?: string }> };
    };
    const textParts =
      row.message?.content
        ?.filter((p) => p.type === "text" && p.text)
        .map((p) => p.text!.trim()) ?? [];
    if (textParts.length) lines.push({ role: row.role ?? "unknown", text: textParts.join("\n") });
  }
  return lines;
}

test("cursorTranscriptNoteName shortens long ids", () => {
  const name = cursorTranscriptNoteName("a1ec3572-0b47-4121-9bf9-0af43233b5af");
  assert.match(name, /^cursor\./);
  assert.ok(name.length <= 64);
});

test("formatCursorTranscriptMarkdown renders user and assistant", () => {
  const raw = [
    JSON.stringify({
      role: "user",
      message: { content: [{ type: "text", text: "Hello world" }] },
    }),
    JSON.stringify({
      role: "assistant",
      message: { content: [{ type: "text", text: "Hi there" }] },
    }),
  ].join("\n");
  const lines = parseLines(raw);
  const md = formatCursorTranscriptMarkdown("abc", "/tmp/abc.jsonl", lines, "2026-06-13T00:00:00.000Z");
  assert.match(md, /Hello world/);
  assert.match(md, /Hi there/);
});

test("mineCursorTranscriptFile upserts episodic note", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "cursor-mine-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ model: "m", runtime: "local", cwd: dir, stateDir: ".agent" }),
    "utf8"
  );
  const file = join(dir, "chat.jsonl");
  writeFileSync(
    file,
    JSON.stringify({
      role: "user",
      message: { content: [{ type: "text", text: "test question" }] },
    }) + "\n"
  );
  const memory = createMemoryStore(dir);
  try {
    const r = await mineCursorTranscriptFile(memory, file);
    assert.equal(r, "ingested");
    const note = await memory.getNote(cursorTranscriptNoteName("chat"));
    assert.match(note?.body ?? "", /test question/);
    assert.equal(note?.wing, "cursor-ide");
  } finally {
    await memory.close();
  }
});

test("discoverCursorTranscriptFiles finds jsonl under agent-transcripts", () => {
  const root = mkdtempSync(resolve(tmpdir(), "cursor-disc-"));
  const transcripts = join(root, "proj-a", "agent-transcripts", "uuid-1");
  mkdirSync(transcripts, { recursive: true });
  writeFileSync(join(transcripts, "uuid-1.jsonl"), "{}\n");
  const found = discoverCursorTranscriptFiles(root);
  assert.equal(found.length, 1);
});
