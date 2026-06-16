import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasLegacyLessonHtmlMeta,
  migrateLessonBodyToOkf,
  parseLessonLineage,
  parseOkfDocument,
  serializeOkfDocument,
  stripLegacyLessonHtmlMeta,
  titleFromOkfOrBody,
  validateOkfConformance,
} from "../src/okf.js";

test("parseOkfDocument reads YAML frontmatter", () => {
  const raw = `---
type: Playbook
title: TParser digest
description: Bi-hourly cron flow
tags: [csagent, tparser]
source: cursor.abc
sourceHash: deadbeef
---
## Summary

- bullet
`;
  const doc = parseOkfDocument(raw);
  assert.ok(doc);
  assert.equal(doc!.frontmatter.type, "Playbook");
  assert.equal(doc!.frontmatter.source, "cursor.abc");
  assert.match(doc!.body, /## Summary/);
});

test("parseLessonLineage reads OKF and legacy HTML", () => {
  const okf = `---
type: Playbook
source: cursor.x
sourceHash: aaa111
status: proposal
---
# Body`;
  assert.deepEqual(parseLessonLineage(okf), {
    source: "cursor.x",
    sourceHash: "aaa111",
    status: "proposal",
  });
  const legacy =
    "<!-- csagent cursor-lesson; source=cursor.y; sourceHash=bbb222; status=proposal -->\n# L";
  assert.deepEqual(parseLessonLineage(legacy), {
    source: "cursor.y",
    sourceHash: "bbb222",
    status: "proposal",
  });
});

test("migrateLessonBodyToOkf converts legacy lesson", () => {
  const legacy = `<!-- csagent cursor-lesson; source=cursor.z; sourceHash=ccc333; status=proposal -->

# Cursor agent-z

## Summary

- TParser bi-hourly digest with seen_post dedup.

## Playbook

1. curl recent-live
2. filter topic_tags
`;
  const out = migrateLessonBodyToOkf({
    name: "lesson.z",
    wing: "cursor-lesson",
    body: legacy,
    updatedAt: "2026-06-15T01:00:00Z",
  });
  const doc = parseOkfDocument(out);
  assert.ok(doc);
  assert.equal(doc!.frontmatter.type, "Playbook");
  assert.equal(doc!.frontmatter.source, "cursor.z");
  assert.equal(doc!.frontmatter.sourceHash, "ccc333");
  assert.match(doc!.frontmatter.description ?? "", /TParser bi-hourly/);
  assert.equal(titleFromOkfOrBody("lesson.z", out), "Cursor agent-z");
});

test("validateOkfConformance flags missing frontmatter", () => {
  const issues = validateOkfConformance("no frontmatter", "cursor-lesson");
  assert.ok(issues.some((i) => i.code === "missing_frontmatter"));
  assert.equal(issues[0]!.severity, "error");
});

test("validateOkfConformance warns on missing recommended fields", () => {
  const raw = `---
type: Playbook
---
## Summary`;
  const issues = validateOkfConformance(raw, "cursor-lesson");
  assert.ok(issues.some((i) => i.code === "missing_title" && i.severity === "warn"));
  assert.ok(issues.some((i) => i.code === "missing_description" && i.severity === "warn"));
  assert.ok(issues.some((i) => i.code === "missing_timestamp" && i.severity === "warn"));
});

test("serialize round-trip preserves extensions", () => {
  const fm = {
    type: "Playbook",
    title: "Test",
    wing: "cursor-lesson",
    okf_version: "0.1",
  };
  const doc = parseOkfDocument(serializeOkfDocument(fm, "## Summary\n\n- x"));
  assert.equal(doc!.frontmatter.title, "Test");
});

test("stripLegacyLessonHtmlMeta removes HTML comment when OKF frontmatter present", () => {
  const raw = serializeOkfDocument(
    {
      type: "Playbook",
      title: "MSK TZ fix",
      source: "cursor.44ea",
      sourceHash: "bb4e12dc452dff4d",
      status: "proposal",
      okf_version: "0.1",
      wing: "cursor-lesson",
    },
    `<!-- csagent cursor-lesson; source=cursor.44ea; sourceHash=613cb297380a8f6b; status=proposal -->

## Summary

- bullet`
  );
  assert.equal(hasLegacyLessonHtmlMeta(raw), true);
  const cleaned = stripLegacyLessonHtmlMeta(raw);
  assert.equal(hasLegacyLessonHtmlMeta(cleaned), false);
  assert.match(cleaned, /sourceHash: bb4e12dc452dff4d/);
  assert.doesNotMatch(cleaned, /613cb297380a8f6b/);
});
