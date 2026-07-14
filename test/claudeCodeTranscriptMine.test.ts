import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  claudeCodeNoteNeedsUpdate,
  claudeCodeTranscriptFileStale,
  claudeCodeTranscriptNoteName,
  discoverClaudeCodeTranscriptFiles,
  formatClaudeCodeTranscriptMarkdown,
  mineClaudeCodeTranscriptFile,
  mineClaudeCodeTranscripts,
  parseClaudeCodeMineMeta,
  resolveClaudeCodeArchiveContentHash,
  truncateClaudeCodeArchiveBody,
  CLAUDE_CODE_ARCHIVE_MAX_BODY_BYTES,
} from "../src/claudeCodeTranscriptMine.js";
import { createMemoryStore } from "../src/memoryStore.js";

// The real parser streams via readline; this inline helper mirrors just enough
// of it to build ParsedLine[] fixtures for the pure format() tests below.
function parseLines(raw: string) {
  const lines: Array<{ role: string; text: string }> = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const row = JSON.parse(trimmed) as {
      type?: string;
      isSidechain?: boolean;
      message?: { content?: string | Array<{ type?: string; text?: string }> };
    };
    if (row.type !== "user" && row.type !== "assistant") continue;
    if (row.isSidechain === true) continue;
    const content = row.message?.content;
    let text = "";
    if (typeof content === "string") {
      text = content.trim();
    } else if (Array.isArray(content)) {
      text = content
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text!.trim())
        .join("\n");
    }
    if (text) lines.push({ role: row.type, text });
  }
  return lines;
}

test("claudeCodeTranscriptNoteName shortens long ids and prefixes cc.", () => {
  const name = claudeCodeTranscriptNoteName("a1ec3572-0b47-4121-9bf9-0af43233b5af");
  assert.match(name, /^cc\./);
  assert.ok(name.length <= 64);
});

test("formatClaudeCodeTranscriptMarkdown renders user and assistant", () => {
  const raw = [
    JSON.stringify({
      type: "user",
      isSidechain: false,
      message: { role: "user", content: [{ type: "text", text: "Hello world" }] },
    }),
    JSON.stringify({
      type: "assistant",
      isSidechain: false,
      message: { role: "assistant", content: [{ type: "text", text: "Hi there" }] },
    }),
  ].join("\n");
  const lines = parseLines(raw);
  const md = formatClaudeCodeTranscriptMarkdown(
    "abc",
    "/tmp/abc.jsonl",
    lines,
    "2026-06-13T00:00:00.000Z"
  );
  assert.match(md, /## User/);
  assert.match(md, /Hello world/);
  assert.match(md, /## Assistant/);
  assert.match(md, /Hi there/);
});

test("claudeCodeNoteNeedsUpdate compares embedded hash, not hash of body including comment", () => {
  const base = formatClaudeCodeTranscriptMarkdown(
    "abc",
    "/tmp/abc.jsonl",
    [{ role: "user", text: "hi" }],
    "2026-06-13T00:00:00.000Z"
  );
  const hash = createHash("sha256").update(base).digest("hex").slice(0, 16);
  const withHash = base.replace("-->", `; hash=${hash} -->`);
  assert.equal(claudeCodeNoteNeedsUpdate(withHash, withHash, false), false);
});

test("mineClaudeCodeTranscriptFile excludes sidechain/noise/thinking, keeps string+text content", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "cc-mine-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ model: "m", runtime: "local", cwd: dir, stateDir: ".agent" }),
    "utf8"
  );
  const file = join(dir, "session.jsonl");
  const fixtureLines = [
    // noise type — must be dropped by the user/assistant allowlist
    JSON.stringify({
      type: "attachment",
      isSidechain: false,
      message: { content: [{ type: "text", text: "NOISE_SHOULD_NOT_APPEAR" }] },
    }),
    // subagent branch — must be dropped despite type:'user'
    JSON.stringify({
      type: "user",
      isSidechain: true,
      message: { role: "user", content: [{ type: "text", text: "SIDECHAIN_SHOULD_NOT_APPEAR" }] },
    }),
    // plain-string content — must be included
    JSON.stringify({
      type: "user",
      isSidechain: false,
      message: { role: "user", content: "plain string question" },
    }),
    // array content with thinking (excluded) + text (included) blocks
    JSON.stringify({
      type: "assistant",
      isSidechain: false,
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "secret reasoning SHOULD_NOT_APPEAR", signature: "sig" },
          { type: "text", text: "visible answer text" },
        ],
      },
    }),
    // malformed JSON — must be skipped, not fatal
    "{not json",
  ].join("\n");
  writeFileSync(file, fixtureLines + "\n");

  const memory = createMemoryStore(dir);
  try {
    const r = await mineClaudeCodeTranscriptFile(memory, file);
    assert.equal(r, "ingested");
    const note = await memory.getNote(claudeCodeTranscriptNoteName("session"));
    const body = note?.body ?? "";
    assert.match(body, /plain string question/);
    assert.match(body, /visible answer text/);
    assert.doesNotMatch(body, /NOISE_SHOULD_NOT_APPEAR/);
    assert.doesNotMatch(body, /SIDECHAIN_SHOULD_NOT_APPEAR/);
    assert.doesNotMatch(body, /secret reasoning SHOULD_NOT_APPEAR/);
    assert.equal(note?.wing, "claude-code");
    assert.match(parseClaudeCodeMineMeta(note?.body).hash ?? "", /^[a-f0-9]{16}$/);
  } finally {
    await memory.close();
  }
});

test("mineClaudeCodeTranscriptFile excludes tool_result/tool_use blocks (I-162 review: highest-risk leak path)", async () => {
  // tool_result blocks carry raw shell/tool output (the actual secret-leak
  // surface flagged in I-162's own security note) — only sibling type:'text'
  // blocks in the same content array may pass through.
  const dir = mkdtempSync(resolve(tmpdir(), "cc-mine-toolresult-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ model: "m", runtime: "local", cwd: dir, stateDir: ".agent" }),
    "utf8"
  );
  const file = join(dir, "session.jsonl");
  const fixtureLines = [
    // tool_result delivered as a role:user message — must be excluded
    JSON.stringify({
      type: "user",
      isSidechain: false,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: "$ env | grep IRIDA\nIRIDA_SECRETS_KEY=SHOULD_NOT_APPEAR_raw_tool_output",
          },
          { type: "text", text: "the command finished" },
        ],
      },
    }),
    // tool_use block on an assistant line — must be excluded
    JSON.stringify({
      type: "assistant",
      isSidechain: false,
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "env | grep IRIDA_SHOULD_NOT_APPEAR" } },
          { type: "text", text: "running the check now" },
        ],
      },
    }),
  ].join("\n");
  writeFileSync(file, fixtureLines + "\n");

  const memory = createMemoryStore(dir);
  try {
    const r = await mineClaudeCodeTranscriptFile(memory, file);
    assert.equal(r, "ingested");
    const note = await memory.getNote(claudeCodeTranscriptNoteName("session"));
    const body = note?.body ?? "";
    assert.match(body, /the command finished/);
    assert.match(body, /running the check now/);
    assert.doesNotMatch(body, /SHOULD_NOT_APPEAR/);
    assert.doesNotMatch(body, /env \| grep/);
  } finally {
    await memory.close();
  }
});

test("discoverClaudeCodeTranscriptFiles finds jsonl directly under a project dir, not subagents/", () => {
  const root = mkdtempSync(resolve(tmpdir(), "cc-disc-"));
  const projectDir = join(root, "-Users-nsh-proj-a");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "uuid-1.jsonl"), "{}\n");

  const subagents = join(projectDir, "uuid-1", "subagents");
  mkdirSync(subagents, { recursive: true });
  writeFileSync(join(subagents, "agent-1.jsonl"), "{}\n");

  const found = discoverClaudeCodeTranscriptFiles(root);
  assert.equal(found.length, 1);
  assert.match(found[0]!, /uuid-1\.jsonl$/);
});

test("claudeCodeTranscriptFileStale skips when file mtime not newer than note", () => {
  const mtimeIso = "2026-06-13T12:00:00.000Z";
  const body = formatClaudeCodeTranscriptMarkdown(
    "abc",
    "/tmp/abc.jsonl",
    [{ role: "user", text: "hi" }],
    mtimeIso
  );
  const storedMs = Date.parse(mtimeIso);
  assert.equal(claudeCodeTranscriptFileStale(storedMs, body, false), false);
  assert.equal(claudeCodeTranscriptFileStale(storedMs + 1000, body, false), true);
  assert.equal(claudeCodeTranscriptFileStale(storedMs, body, true), true);
});

test("mineClaudeCodeTranscripts --all re-ingests when jsonl mtime advances", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "cc-mine-all-"));
  const projectsRoot = join(dir, "projects");
  const projectDir = join(projectsRoot, "-Users-nsh-proj");
  mkdirSync(join(dir, ".agent"), { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ model: "m", runtime: "local", cwd: dir, stateDir: ".agent" }),
    "utf8"
  );
  const file = join(projectDir, "chat-id.jsonl");
  const line = JSON.stringify({
    type: "user",
    isSidechain: false,
    message: { role: "user", content: [{ type: "text", text: "first" }] },
  });
  writeFileSync(file, line + "\n");

  const first = await mineClaudeCodeTranscripts(dir, { all: true, projectsRoot });
  assert.equal(first.ingested, 1);

  writeFileSync(file, line + "\n" + line + "\n");
  const past = Date.now() - 60_000;
  utimesSync(file, past / 1000, past / 1000);

  const skipOld = await mineClaudeCodeTranscripts(dir, { all: true, projectsRoot });
  assert.equal(skipOld.updated, 0);
  assert.equal(skipOld.skipped, 1);

  utimesSync(file, Date.now() / 1000, Date.now() / 1000);
  const second = await mineClaudeCodeTranscripts(dir, { all: true, projectsRoot });
  assert.equal(second.updated, 1);
});

test("parseClaudeCodeMineMeta reads mtime and hash from note header", () => {
  const md = formatClaudeCodeTranscriptMarkdown(
    "x",
    "/f",
    [{ role: "user", text: "a" }],
    "2026-06-01T00:00:00.000Z"
  );
  const withHash = md.replace("-->", "; hash=abc123deadbeef -->");
  const meta = parseClaudeCodeMineMeta(withHash);
  assert.equal(meta.hash, "abc123deadbeef");
  assert.ok(Number.isFinite(meta.mtimeMs));
});

test("parseClaudeCodeMineMeta reads hash outside malformed comment", () => {
  const body =
    "<!-- csagent claude-code mine; id=abc; mtime=2026-06-01T00:00:00.000Z -->; hash=deadbeef01234567\n\n# t";
  const meta = parseClaudeCodeMineMeta(body);
  assert.equal(meta.hash, "deadbeef01234567");
});

test("resolveClaudeCodeArchiveContentHash falls back to content hash", () => {
  const body =
    "<!-- csagent claude-code mine; id=x; mtime=2026-06-01T00:00:00.000Z -->\n\n# Title\n\nhello";
  const h = resolveClaudeCodeArchiveContentHash(body);
  assert.match(h ?? "", /^[a-f0-9]{16}$/);
});

test("truncateClaudeCodeArchiveBody caps oversized archive", () => {
  const huge = "x".repeat(CLAUDE_CODE_ARCHIVE_MAX_BODY_BYTES + 5000);
  const out = truncateClaudeCodeArchiveBody(huge);
  assert.ok(Buffer.byteLength(out, "utf8") <= CLAUDE_CODE_ARCHIVE_MAX_BODY_BYTES);
  assert.match(out, /truncated: archive body capped/);
});
