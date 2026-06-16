import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CURSOR_LESSON_WING, CURSOR_TRANSCRIPT_WING } from "../src/memoryWings.js";
import { createMemoryStore } from "../src/memoryStore.js";
import {
  auditCursorLessonCorpus,
  auditLessonNote,
  backfillLessonLineage,
  exportOkfLessonBundle,
  inferLessonDisplayTitle,
  promoteCursorLessons,
  purgeLessonHygiene,
  purgeLessonShard,
  purgeMetaDistill,
  repairLessonTitles,
  stripLegacyLessonMeta,
  META_DISTILL_EXEMPLAR_KEEP,
} from "../src/memoryOkf.js";
import { serializeOkfDocument } from "../src/okf.js";

function lessonBody(title: string, steps: string): string {
  return serializeOkfDocument(
    {
      type: "Playbook",
      title,
      description: title,
      resource: "memory://lesson.x",
      timestamp: "2026-06-15T00:00:00Z",
      okf_version: "0.1",
      wing: CURSOR_LESSON_WING,
      status: "proposal",
      source: "cursor.x",
    },
    `## Summary\n\n- ${title}\n\n## Steps\n\n${steps}`
  );
}

function setupDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "mem-okf-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ model: "m", runtime: "local", cwd: dir, stateDir: ".agent" }),
    "utf8"
  );
  return dir;
}

test("exportOkfLessonBundle writes shard tree and index.md", async () => {
  const dir = setupDir();
  const memory = createMemoryStore(dir);
  const outDir = join(dir, "bundle");
  try {
    await memory.upsertNote({
      name: "lesson.good",
      wing: CURSOR_LESSON_WING,
      body: lessonBody("TParser digest", "1. step one\n2. step two"),
    });
    await memory.upsertNote({
      name: "lesson.test",
      wing: CURSOR_LESSON_WING,
      body: lessonBody("fixture", "1. only"),
    });
  } finally {
    await memory.close();
  }

  const exported = await exportOkfLessonBundle(dir, outDir);
  assert.ok(existsSync(exported.indexPath));
  assert.ok(existsSync(join(outDir, "tparser", "lesson-good.md")));
  assert.ok(existsSync(join(outDir, "_quarantine", "fixtures", "index.md")));
  const root = readFileSync(exported.indexPath, "utf8");
  assert.match(root, /tparser/);
  assert.equal(exported.orphansRemoved, 0);
});

test("exportOkfLessonBundle prunes orphan markdown from prior export", async () => {
  const dir = setupDir();
  const memory = createMemoryStore(dir);
  const outDir = join(dir, "bundle");
  try {
    await memory.upsertNote({
      name: "lesson.keep",
      wing: CURSOR_LESSON_WING,
      body: lessonBody("TParser keep", "1. a\n2. b\n3. c"),
    });
    await memory.upsertNote({
      name: "lesson.gone",
      wing: CURSOR_LESSON_WING,
      body: lessonBody("TParser gone", "1. x\n2. y\n3. z"),
    });
  } finally {
    await memory.close();
  }

  await exportOkfLessonBundle(dir, outDir);
  const gonePath = join(outDir, "tparser", "lesson-gone.md");
  assert.ok(existsSync(gonePath));

  const memory2 = createMemoryStore(dir);
  try {
    await memory2.deleteNote("lesson.gone");
  } finally {
    await memory2.close();
  }

  const second = await exportOkfLessonBundle(dir, outDir);
  assert.equal(second.orphansRemoved, 1);
  assert.ok(!existsSync(gonePath));
  assert.ok(existsSync(join(outDir, "tparser", "lesson-keep.md")));
});

test("purgeLessonHygiene dry-run then apply removes fixtures and stubs", async () => {
  const dir = setupDir();
  const memory = createMemoryStore(dir);
  const keepBody = lessonBody(
    "Keep me",
    "1. a\n2. b\n3. c\n\n" + "Extra context line for size.\n".repeat(40)
  );
  assert.ok(Buffer.byteLength(keepBody, "utf8") >= 800, "keep fixture must exceed stub byte threshold");
  try {
    await memory.upsertNote({
      name: "lesson.test",
      wing: CURSOR_LESSON_WING,
      body: lessonBody("fixture lesson", "1. x"),
    });
    await memory.upsertNote({
      name: "lesson.stub",
      wing: CURSOR_LESSON_WING,
      body: "## Summary\n\n- tiny",
    });
    await memory.upsertNote({
      name: "lesson.keep",
      wing: CURSOR_LESSON_WING,
      body: keepBody,
    });
  } finally {
    await memory.close();
  }

  const keepRow = auditLessonNote({
    name: "lesson.keep",
    wing: CURSOR_LESSON_WING,
    title: "Keep me",
    body: keepBody,
    created_at: "",
    updated_at: "",
  });
  assert.equal(keepRow.flags.stub, false, `lesson.keep should not be stub: ${JSON.stringify(keepRow.flags)}`);

  const dry = await purgeLessonHygiene(dir, {});
  assert.equal(dry.dryRun, true);
  assert.equal(dry.deleted, 0);
  assert.ok(dry.candidates.some((c) => c.name === "lesson.test"));
  assert.ok(dry.candidates.some((c) => c.name === "lesson.stub"));
  assert.ok(!dry.candidates.some((c) => c.name === "lesson.keep"));

  const applied = await purgeLessonHygiene(dir, { apply: true });
  assert.equal(applied.deleted, dry.candidates.length);

  const audit = await auditCursorLessonCorpus(dir);
  assert.equal(audit.count, 1);
  assert.equal(audit.rows[0]?.name, "lesson.keep");
});

test("purgeMetaDistill keeps exemplars and removes other meta-distill notes", async () => {
  const dir = setupDir();
  const memory = createMemoryStore(dir);
  const keepName = META_DISTILL_EXEMPLAR_KEEP[0]!;
  const metaBody = serializeOkfDocument(
    {
      type: "Playbook",
      title: "Meta session",
      description: "Meta-сессия: distill nested transcript",
      resource: `memory://${keepName}`,
      timestamp: "2026-06-15T00:00:00Z",
      okf_version: "0.1",
      wing: CURSOR_LESSON_WING,
      status: "proposal",
      source: "cursor.x",
    },
    "## Summary\n\n- Meta-сессия: distill nested transcript\n\n## Steps\n\n1. read template\n2. write proposal\n3. wc -c"
  );
  try {
    await memory.upsertNote({ name: keepName, wing: CURSOR_LESSON_WING, body: metaBody });
    await memory.upsertNote({
      name: "lesson.meta-purge-me",
      wing: CURSOR_LESSON_WING,
      body: metaBody.replace(keepName, "lesson.meta-purge-me"),
    });
    await memory.upsertNote({
      name: "lesson.not-meta",
      wing: CURSOR_LESSON_WING,
      body: lessonBody("TParser ops", "1. a\n2. b\n3. c"),
    });
  } finally {
    await memory.close();
  }

  const dry = await purgeMetaDistill(dir, { keepNames: [keepName] });
  assert.equal(dry.candidates.length, 1);
  assert.equal(dry.candidates[0]?.name, "lesson.meta-purge-me");

  const applied = await purgeMetaDistill(dir, { apply: true, keepNames: [keepName] });
  assert.equal(applied.deleted, 1);

  const audit = await auditCursorLessonCorpus(dir);
  assert.equal(audit.count, 2);
  assert.ok(audit.rows.some((r) => r.name === keepName));
  assert.ok(audit.rows.some((r) => r.name === "lesson.not-meta"));
});

test("purgeLessonShard keeps only names from keep file", async () => {
  const dir = setupDir();
  const memory = createMemoryStore(dir);
  const keepName = "lesson.tparser-keep";
  const body = lessonBody("TParser bi-hourly", "1. a\n2. b\n3. c");
  try {
    await memory.upsertNote({
      name: keepName,
      wing: CURSOR_LESSON_WING,
      body: body.replace("TParser bi-hourly", "TParser digest cron"),
    });
    await memory.upsertNote({
      name: "lesson.tparser-purge",
      wing: CURSOR_LESSON_WING,
      body: body.replace("TParser bi-hourly", "TParser duplicate run"),
    });
  } finally {
    await memory.close();
  }

  const dry = await purgeLessonShard(dir, {
    shard: "A-tparser",
    keepNames: [keepName],
  });
  assert.equal(dry.candidates.length, 1);
  assert.equal(dry.candidates[0]?.name, "lesson.tparser-purge");

  await purgeLessonShard(dir, { shard: "A-tparser", keepNames: [keepName], apply: true });
  const audit = await auditCursorLessonCorpus(dir);
  assert.equal(audit.rows.filter((r) => r.shard === "A-tparser").length, 1);
});

test("backfillLessonLineage patches missing sourceHash from archive", async () => {
  const dir = setupDir();
  const memory = createMemoryStore(dir);
  const source = "cursor.abc12345-1234-5678-9abc-def012345678";
  const lessonName = "lesson.abc12345-1234-5678-9abc-def012345678";
  const lessonBody = serializeOkfDocument(
    {
      type: "Playbook",
      title: lessonName,
      description: "TParser digest ops",
      resource: `memory://${lessonName}`,
      okf_version: "0.1",
      wing: CURSOR_LESSON_WING,
      status: "proposal",
      source,
    },
    "## Summary\n\n- TParser digest\n\n## Steps\n\n1. a\n2. b\n3. c"
  );
  try {
    await memory.upsertNote({
      name: source,
      wing: CURSOR_TRANSCRIPT_WING,
      body: `<!-- csagent cursor-ide mine; id=abc; mtime=2026-06-15T00:00:00Z; hash=deadbeef12345678 -->\n# chat`,
    });
    await memory.upsertNote({ name: lessonName, wing: CURSOR_LESSON_WING, body: lessonBody });
  } finally {
    await memory.close();
  }

  const dry = await backfillLessonLineage(dir, {});
  assert.equal(dry.candidates.length, 1);
  assert.equal(dry.candidates[0]?.reason, "missing_sourceHash");

  const applied = await backfillLessonLineage(dir, { apply: true });
  assert.equal(applied.updated, 1);

  const memory2 = createMemoryStore(dir);
  const note = await memory2.getNote(lessonName);
  await memory2.close();
  assert.match(note?.body ?? "", /sourceHash: deadbeef12345678/);
});

test("repairLessonTitles uses description for uuid-like titles", async () => {
  const body = serializeOkfDocument(
    {
      type: "Playbook",
      title: "lesson.abc12345-1234-5678-9abc-def012345678",
      description: "TParser bi-hourly digest cron setup",
      resource: "memory://lesson.x",
      okf_version: "0.1",
      wing: CURSOR_LESSON_WING,
      status: "proposal",
      source: "cursor.x",
    },
    "## Summary\n\n- x\n\n## Steps\n\n1. a\n2. b"
  );
  const title = inferLessonDisplayTitle(body, "lesson.abc12345-1234-5678-9abc-def012345678");
  assert.equal(title, "TParser bi-hourly digest cron setup");

  const dir = setupDir();
  const memory = createMemoryStore(dir);
  try {
    await memory.upsertNote({
      name: "lesson.fix-title",
      wing: CURSOR_LESSON_WING,
      body,
    });
  } finally {
    await memory.close();
  }
  const applied = await repairLessonTitles(dir, { apply: true });
  assert.equal(applied.updated, 1);
  const memory2 = createMemoryStore(dir);
  const note = await memory2.getNote("lesson.fix-title");
  await memory2.close();
  assert.match(note?.body ?? "", /title: TParser bi-hourly digest cron setup/);
});

test("stripLegacyLessonMeta removes duplicate HTML lineage from OKF lessons", async () => {
  const dir = setupDir();
  const memory = createMemoryStore(dir);
  const name = "lesson.legacy-html";
  const body = serializeOkfDocument(
    {
      type: "Playbook",
      title: "TParser ops",
      description: "MSK timezone display",
      resource: `memory://${name}`,
      okf_version: "0.1",
      wing: CURSOR_LESSON_WING,
      status: "proposal",
      source: "cursor.legacy",
      sourceHash: "abc123deadbeef01",
    },
    `<!-- csagent cursor-lesson; source=cursor.legacy; sourceHash=oldhash0000000001; status=proposal -->

## Summary

- MSK fix`
  );
  try {
    await memory.upsertNote({ name, wing: CURSOR_LESSON_WING, body });
  } finally {
    await memory.close();
  }

  const dry = await stripLegacyLessonMeta(dir, {});
  assert.equal(dry.candidates.length, 1);
  assert.equal(dry.candidates[0], name);

  const applied = await stripLegacyLessonMeta(dir, { apply: true });
  assert.equal(applied.updated, 1);

  const memory2 = createMemoryStore(dir);
  const note = await memory2.getNote(name);
  await memory2.close();
  assert.doesNotMatch(note?.body ?? "", /oldhash0000000001/);
  assert.match(note?.body ?? "", /sourceHash: abc123deadbeef01/);
});

test("promoteCursorLessons sets status approved", async () => {
  const dir = setupDir();
  const memory = createMemoryStore(dir);
  const name = "lesson.to-promote";
  const body = serializeOkfDocument(
    {
      type: "Playbook",
      title: "Gateway ops",
      description: "Outbox multipart",
      resource: `memory://${name}`,
      okf_version: "0.1",
      wing: CURSOR_LESSON_WING,
      status: "proposal",
      source: "cursor.x",
    },
    "## Summary\n\n- x\n\n## Steps\n\n1. a"
  );
  try {
    await memory.upsertNote({ name, wing: CURSOR_LESSON_WING, body });
  } finally {
    await memory.close();
  }

  const dry = await promoteCursorLessons(dir, { names: [name] });
  assert.equal(dry.candidates.length, 1);

  const applied = await promoteCursorLessons(dir, { names: [name], apply: true });
  assert.equal(applied.updated, 1);

  const memory2 = createMemoryStore(dir);
  const note = await memory2.getNote(name);
  await memory2.close();
  assert.match(note?.body ?? "", /status: approved/);

  const again = await promoteCursorLessons(dir, { names: [name], apply: true });
  assert.equal(again.skipped, 1);
  assert.equal(again.updated, 0);
});
