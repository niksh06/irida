import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  codexNoteNeedsUpdate,
  codexTranscriptFileStale,
  codexTranscriptIdFromPath,
  codexTranscriptNoteName,
  discoverCodexMainThreadFiles,
  discoverCodexTranscriptFiles,
  formatCodexTranscriptMarkdown,
  mineCodexTranscriptFile,
  mineCodexTranscripts,
  parseCodexMineMeta,
  resolveCodexArchiveContentHash,
  truncateCodexArchiveBody,
  CODEX_ARCHIVE_MAX_BODY_BYTES,
} from "../src/codexTranscriptMine.js";
import { createMemoryStore } from "../src/memoryStore.js";

test("codexTranscriptNoteName shortens long ids and prefixes codex.", () => {
  const name = codexTranscriptNoteName("019f4818-028b-71f0-b08a-c3f6c788aed7");
  assert.match(name, /^codex\./);
  assert.ok(name.length <= 64);
});

test("codexTranscriptIdFromPath extracts the uuid suffix from a rollout filename", () => {
  const id = codexTranscriptIdFromPath(
    "/x/y/rollout-2026-07-09T21-16-01-019f4818-028b-71f0-b08a-c3f6c788aed7.jsonl"
  );
  assert.equal(id, "019f4818-028b-71f0-b08a-c3f6c788aed7");
});

test("formatCodexTranscriptMarkdown renders user and assistant", () => {
  const lines = [
    { role: "user", text: "Hello world" },
    { role: "assistant", text: "Hi there" },
  ];
  const md = formatCodexTranscriptMarkdown(
    "019f4818-028b-71f0-b08a-c3f6c788aed7",
    "/tmp/rollout-x.jsonl",
    lines,
    "2026-07-09T00:00:00.000Z"
  );
  assert.match(md, /## User/);
  assert.match(md, /Hello world/);
  assert.match(md, /## Assistant/);
  assert.match(md, /Hi there/);
});

test("codexNoteNeedsUpdate compares embedded hash, not hash of body including comment", () => {
  const base = formatCodexTranscriptMarkdown(
    "019f4818-028b-71f0-b08a-c3f6c788aed7",
    "/tmp/rollout-x.jsonl",
    [{ role: "user", text: "hi" }],
    "2026-07-09T00:00:00.000Z"
  );
  const hash = createHash("sha256").update(base).digest("hex").slice(0, 16);
  const withHash = base.replace("-->", `; hash=${hash} -->`);
  assert.equal(codexNoteNeedsUpdate(withHash, withHash, false), false);
});

test("mineCodexTranscriptFile keeps user/agent messages, excludes token_count/sub_agent_activity/malformed", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "codex-mine-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ model: "m", runtime: "local", cwd: dir, stateDir: ".agent" }),
    "utf8"
  );
  const file = join(dir, "rollout-2026-07-09T20-26-32-019f47ea-b868-7bb2-8369-6801dee0d62c.jsonl");
  const fixtureLines = [
    JSON.stringify({
      timestamp: "2026-07-09T20:26:32.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: "plain user question" },
    }),
    // non-conversational event_msg type — must be dropped by the allowlist
    JSON.stringify({
      timestamp: "2026-07-09T20:26:33.000Z",
      type: "event_msg",
      payload: { type: "token_count", TOKEN_NOISE_SHOULD_NOT_APPEAR: true },
    }),
    // sub_agent_activity — must be dropped despite being an event_msg
    JSON.stringify({
      timestamp: "2026-07-09T20:26:34.000Z",
      type: "event_msg",
      payload: {
        type: "sub_agent_activity",
        event_id: "call_1",
        agent_thread_id: "SUBAGENT_SHOULD_NOT_APPEAR",
        agent_path: "/root/audit",
        kind: "started",
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-09T20:26:35.000Z",
      type: "event_msg",
      payload: { type: "agent_message", message: "visible answer text" },
    }),
    // non-event_msg top-level type — must be dropped too
    JSON.stringify({
      timestamp: "2026-07-09T20:26:36.000Z",
      type: "response_item",
      payload: { type: "message", role: "assistant", content: "RESPONSE_ITEM_SHOULD_NOT_APPEAR" },
    }),
    // malformed JSON — must be skipped, not fatal
    "{not json",
  ].join("\n");
  writeFileSync(file, fixtureLines + "\n");

  const memory = createMemoryStore(dir);
  try {
    const r = await mineCodexTranscriptFile(memory, file);
    assert.equal(r, "ingested");
    const note = await memory.getNote(
      codexTranscriptNoteName("019f47ea-b868-7bb2-8369-6801dee0d62c")
    );
    const body = note?.body ?? "";
    assert.match(body, /plain user question/);
    assert.match(body, /visible answer text/);
    assert.doesNotMatch(body, /TOKEN_NOISE_SHOULD_NOT_APPEAR/);
    assert.doesNotMatch(body, /SUBAGENT_SHOULD_NOT_APPEAR/);
    assert.doesNotMatch(body, /RESPONSE_ITEM_SHOULD_NOT_APPEAR/);
    assert.equal(note?.wing, "codex");
    assert.match(parseCodexMineMeta(note?.body).hash ?? "", /^[a-f0-9]{16}$/);
  } finally {
    await memory.close();
  }
});

test("discoverCodexMainThreadFiles finds rollout jsonl under YYYY/MM/DD, excludes subagent-forked threads", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "codex-disc-"));
  const dayDir = join(root, "2026", "07", "09");
  mkdirSync(dayDir, { recursive: true });

  const mainFile = join(dayDir, "rollout-2026-07-09T20-26-32-019f47ea-0000-0000-0000-000000000001.jsonl");
  writeFileSync(
    mainFile,
    JSON.stringify({
      timestamp: "2026-07-09T20:26:32.000Z",
      type: "session_meta",
      payload: { session_id: "019f47ea-0000-0000-0000-000000000001", id: "019f47ea-0000-0000-0000-000000000001" },
    }) + "\n"
  );

  const subFile = join(dayDir, "rollout-2026-07-09T20-36-36-019f4898-0000-0000-0000-000000000002.jsonl");
  writeFileSync(
    subFile,
    JSON.stringify({
      timestamp: "2026-07-09T20:36:36.000Z",
      type: "session_meta",
      payload: {
        session_id: "019f4818-0000-0000-0000-000000000000",
        id: "019f4898-0000-0000-0000-000000000002",
        forked_from_id: "019f4818-0000-0000-0000-000000000000",
        thread_source: "subagent",
      },
    }) + "\n"
  );

  const allFound = discoverCodexTranscriptFiles(root);
  assert.equal(allFound.length, 2);

  const mainOnly = await discoverCodexMainThreadFiles(root);
  assert.equal(mainOnly.length, 1);
  assert.match(mainOnly[0]!, /019f47ea-0000-0000-0000-000000000001\.jsonl$/);
});

test("codexTranscriptFileStale skips when file mtime not newer than note", () => {
  const mtimeIso = "2026-07-09T12:00:00.000Z";
  const body = formatCodexTranscriptMarkdown(
    "019f4818-028b-71f0-b08a-c3f6c788aed7",
    "/tmp/rollout-x.jsonl",
    [{ role: "user", text: "hi" }],
    mtimeIso
  );
  const storedMs = Date.parse(mtimeIso);
  assert.equal(codexTranscriptFileStale(storedMs, body, false), false);
  assert.equal(codexTranscriptFileStale(storedMs + 1000, body, false), true);
  assert.equal(codexTranscriptFileStale(storedMs, body, true), true);
});

test("mineCodexTranscripts --all re-ingests when jsonl mtime advances", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "codex-mine-all-"));
  const sessionsRoot = join(dir, "sessions");
  const dayDir = join(sessionsRoot, "2026", "07", "09");
  mkdirSync(join(dir, ".agent"), { recursive: true });
  mkdirSync(dayDir, { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ model: "m", runtime: "local", cwd: dir, stateDir: ".agent" }),
    "utf8"
  );
  const file = join(dayDir, "rollout-2026-07-09T20-26-32-019f47ea-0000-0000-0000-000000000009.jsonl");
  const line = JSON.stringify({
    timestamp: "2026-07-09T20:26:32.000Z",
    type: "event_msg",
    payload: { type: "user_message", message: "first" },
  });
  writeFileSync(file, line + "\n");

  const first = await mineCodexTranscripts(dir, { all: true, sessionsRoot });
  assert.equal(first.ingested, 1);

  writeFileSync(file, line + "\n" + line + "\n");
  const past = Date.now() - 60_000;
  utimesSync(file, past / 1000, past / 1000);

  const skipOld = await mineCodexTranscripts(dir, { all: true, sessionsRoot });
  assert.equal(skipOld.updated, 0);
  assert.equal(skipOld.skipped, 1);

  utimesSync(file, Date.now() / 1000, Date.now() / 1000);
  const second = await mineCodexTranscripts(dir, { all: true, sessionsRoot });
  assert.equal(second.updated, 1);
});

test("parseCodexMineMeta reads mtime and hash from note header", () => {
  const md = formatCodexTranscriptMarkdown(
    "019f4818-028b-71f0-b08a-c3f6c788aed7",
    "/f",
    [{ role: "user", text: "a" }],
    "2026-07-01T00:00:00.000Z"
  );
  const withHash = md.replace("-->", "; hash=abc123deadbeef -->");
  const meta = parseCodexMineMeta(withHash);
  assert.equal(meta.hash, "abc123deadbeef");
  assert.ok(Number.isFinite(meta.mtimeMs));
});

test("parseCodexMineMeta reads hash outside malformed comment", () => {
  const body =
    "<!-- csagent codex mine; id=abc; mtime=2026-07-01T00:00:00.000Z -->; hash=deadbeef01234567\n\n# t";
  const meta = parseCodexMineMeta(body);
  assert.equal(meta.hash, "deadbeef01234567");
});

test("resolveCodexArchiveContentHash falls back to content hash", () => {
  const body =
    "<!-- csagent codex mine; id=x; mtime=2026-07-01T00:00:00.000Z -->\n\n# Title\n\nhello";
  const h = resolveCodexArchiveContentHash(body);
  assert.match(h ?? "", /^[a-f0-9]{16}$/);
});

test("truncateCodexArchiveBody caps oversized archive", () => {
  const huge = "x".repeat(CODEX_ARCHIVE_MAX_BODY_BYTES + 5000);
  const out = truncateCodexArchiveBody(huge);
  assert.ok(Buffer.byteLength(out, "utf8") <= CODEX_ARCHIVE_MAX_BODY_BYTES);
  assert.match(out, /truncated: archive body capped/);
});
