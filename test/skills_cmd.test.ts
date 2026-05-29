import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { cmdSkillsList, cmdSkillsSearch, cmdSkills } from "../src/skills_cmd.js";
import { EXIT } from "../src/exit.js";

function tmp(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "skcmd-"));
  const sk = join(dir, "skills");
  mkdirSync(sk, { recursive: true });
  writeFileSync(
    join(sk, "review.md"),
    "---\nname: review\ndescription: code review\ntags: [dev]\n---\nbody"
  );
  return dir;
}

test("skills list prints skills", () => {
  const dir = tmp();
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => logs.push(a.join(" "));
  try {
    assert.equal(cmdSkillsList({ dir }), EXIT.ok);
    const out = logs.join("\n");
    assert.match(out, /review/);
    assert.match(out, /code review/);
  } finally {
    console.log = orig;
  }
});

test("skills list empty dir", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "skempty-"));
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => logs.push(a.join(" "));
  try {
    assert.equal(cmdSkillsList({ dir }), EXIT.ok);
    assert.match(logs.join("\n"), /No skills found/);
  } finally {
    console.log = orig;
  }
});

test("skills search finds by tag", () => {
  const dir = tmp();
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => logs.push(a.join(" "));
  try {
    assert.equal(cmdSkillsSearch("dev", { dir }), EXIT.ok);
    assert.match(logs.join("\n"), /review/);
  } finally {
    console.log = orig;
  }
});

test("skills search without query exits usage", () => {
  assert.equal(cmdSkillsSearch("", { dir: tmp() }), EXIT.usage);
});

test("skills unknown subcommand exits usage", () => {
  assert.equal(cmdSkills(["bogus"], { dir: tmp() }), EXIT.usage);
});
