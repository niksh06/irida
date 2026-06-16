import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  cursorTranscriptNoteName,
  discoverCursorTranscriptFiles,
  formatCursorTranscriptMarkdown,
  mineCursorTranscriptFile,
  mineCursorTranscripts,
  noteNeedsUpdate,
  parseCursorMineMeta,
  resolveArchiveContentHash,
  transcriptFileStale,
  truncateCursorArchiveBody,
  CURSOR_ARCHIVE_MAX_BODY_BYTES,
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

test("noteNeedsUpdate compares embedded hash, not hash of body including comment", () => {
  const base = formatCursorTranscriptMarkdown(
    "abc",
    "/tmp/abc.jsonl",
    [{ role: "user", text: "hi" }],
    "2026-06-13T00:00:00.000Z"
  );
  const hash = createHash("sha256").update(base).digest("hex").slice(0, 16);
  const withHash = base.replace("-->", `; hash=${hash} -->`);
  assert.equal(noteNeedsUpdate(withHash, withHash, false), false);
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
    assert.match(parseCursorMineMeta(note?.body).hash ?? "", /^[a-f0-9]{16}$/);
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

test("transcriptFileStale skips when file mtime not newer than note", () => {
  const mtimeIso = "2026-06-13T12:00:00.000Z";
  const body = formatCursorTranscriptMarkdown("abc", "/tmp/abc.jsonl", [{ role: "user", text: "hi" }], mtimeIso);
  const storedMs = Date.parse(mtimeIso);
  assert.equal(transcriptFileStale(storedMs, body, false), false);
  assert.equal(transcriptFileStale(storedMs + 1000, body, false), true);
  assert.equal(transcriptFileStale(storedMs, body, true), true);
});

test("mineCursorTranscripts --all re-ingests when jsonl mtime advances", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "cursor-mine-all-"));
  const projectsRoot = join(dir, "projects");
  const transcripts = join(projectsRoot, "proj", "agent-transcripts", "chat-id");
  mkdirSync(join(dir, ".agent"), { recursive: true });
  mkdirSync(transcripts, { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ model: "m", runtime: "local", cwd: dir, stateDir: ".agent" }),
    "utf8"
  );
  const file = join(transcripts, "chat-id.jsonl");
  const line = JSON.stringify({
    role: "user",
    message: { content: [{ type: "text", text: "first" }] },
  });
  writeFileSync(file, line + "\n");

  const first = await mineCursorTranscripts(dir, { all: true, projectsRoot });
  assert.equal(first.ingested, 1);

  writeFileSync(file, line + "\n" + line + "\n");
  const past = Date.now() - 60_000;
  utimesSync(file, past / 1000, past / 1000);

  const skipOld = await mineCursorTranscripts(dir, { all: true, projectsRoot });
  assert.equal(skipOld.updated, 0);
  assert.equal(skipOld.skipped, 1);

  utimesSync(file, Date.now() / 1000, Date.now() / 1000);
  const second = await mineCursorTranscripts(dir, { all: true, projectsRoot });
  assert.equal(second.updated, 1);
});

test("parseCursorMineMeta reads mtime and hash from note header", () => {
  const md = formatCursorTranscriptMarkdown("x", "/f", [{ role: "user", text: "a" }], "2026-06-01T00:00:00.000Z");
  const withHash = md.replace("-->", "; hash=abc123deadbeef -->");
  const meta = parseCursorMineMeta(withHash);
  assert.equal(meta.hash, "abc123deadbeef");
  assert.ok(Number.isFinite(meta.mtimeMs));
});

test("parseCursorMineMeta reads hash outside malformed comment", () => {
  const body =
    "<!-- csagent cursor-ide mine; id=abc; mtime=2026-06-01T00:00:00.000Z -->; hash=deadbeef01234567\n\n# t";
  const meta = parseCursorMineMeta(body);
  assert.equal(meta.hash, "deadbeef01234567");
});

test("resolveArchiveContentHash falls back to content hash", () => {
  const body = "<!-- csagent cursor-ide mine; id=x; mtime=2026-06-01T00:00:00.000Z -->\n\n# Title\n\nhello";
  const h = resolveArchiveContentHash(body);
  assert.match(h ?? "", /^[a-f0-9]{16}$/);
});

test("truncateCursorArchiveBody caps oversized archive", () => {
  const huge = "x".repeat(CURSOR_ARCHIVE_MAX_BODY_BYTES + 5000);
  const out = truncateCursorArchiveBody(huge);
  assert.ok(Buffer.byteLength(out, "utf8") <= CURSOR_ARCHIVE_MAX_BODY_BYTES);
  assert.match(out, /truncated: archive body capped/);
});
