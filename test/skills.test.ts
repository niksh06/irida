import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { loadSkill, listSkills, searchSkills, suggestSkillNames, SkillError } from "../src/skills.js";
import { buildPrompt } from "../src/promptBuilder.js";

function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), "skill-"));
}

function seed(dir: string): void {
  const sk = join(dir, "skills");
  mkdirSync(sk, { recursive: true });
  writeFileSync(
    join(sk, "foo.md"),
    "---\nname: foo\ndescription: does foo\ntags: [a, b]\n---\nBODY foo here"
  );
  mkdirSync(join(sk, "bar"), { recursive: true });
  writeFileSync(join(sk, "bar", "SKILL.md"), "---\nname: bar\ndescription: bar skill\n---\nBODY bar");
}

test("loads flat .md skill with frontmatter", () => {
  const dir = tmp();
  seed(dir);
  const s = loadSkill(dir, "skills", "foo");
  assert.equal(s.name, "foo");
  assert.equal(s.description, "does foo");
  assert.deepEqual(s.tags, ["a", "b"]);
  assert.match(s.content, /BODY foo here/);
});

test("loads subdir SKILL.md", () => {
  const dir = tmp();
  seed(dir);
  const s = loadSkill(dir, "skills", "bar");
  assert.equal(s.name, "bar");
  assert.match(s.content, /BODY bar/);
});

test("lists skills", () => {
  const dir = tmp();
  seed(dir);
  const names = listSkills(dir, "skills").map((s) => s.name).sort();
  assert.deepEqual(names, ["bar", "foo"]);
});

test("missing skill throws with available names", () => {
  const dir = tmp();
  seed(dir);
  assert.throws(() => loadSkill(dir, "skills", "nope"), (e: unknown) => {
    assert.ok(e instanceof SkillError);
    assert.match((e as Error).message, /foo/);
    return true;
  });
});

test("missing skill suggests closest name", () => {
  const dir = tmp();
  seed(dir);
  assert.throws(() => loadSkill(dir, "skills", "fo"), (e: unknown) => {
    assert.match((e as Error).message, /Did you mean: foo/);
    return true;
  });
});

test("searchSkills filters by name and tags", () => {
  const dir = tmp();
  seed(dir);
  assert.deepEqual(searchSkills(dir, "skills", "foo").map((s) => s.name), ["foo"]);
  assert.deepEqual(searchSkills(dir, "skills", "bar skill").map((s) => s.name), ["bar"]);
  assert.deepEqual(searchSkills(dir, "skills", "zzz"), []);
});

test("suggestSkillNames ranks by edit distance", () => {
  const dir = tmp();
  seed(dir);
  const all = listSkills(dir, "skills");
  const hints = suggestSkillNames(all, "fo");
  assert.equal(hints[0], "foo");
});

test("listSkills skips unreadable files", () => {
  const dir = tmp();
  const sk = join(dir, "skills");
  mkdirSync(sk, { recursive: true });
  writeFileSync(join(sk, "ok.md"), "---\nname: ok\n---\nbody");
  mkdirSync(join(sk, "broken"), { recursive: true });
  // no SKILL.md in broken/ — only ok listed
  assert.deepEqual(listSkills(dir, "skills").map((s) => s.name), ["ok"]);
});

test("buildPrompt injects skill content as context", () => {
  const dir = tmp();
  seed(dir);
  const s = loadSkill(dir, "skills", "foo");
  const p = buildPrompt("do the task", [s]);
  assert.match(p, /# Skill: foo/);
  assert.match(p, /BODY foo here/);
  assert.match(p, /# Task/);
  assert.match(p, /do the task/);
});

test("buildPrompt without skills is identity", () => {
  assert.equal(buildPrompt("just this", []), "just this");
});
