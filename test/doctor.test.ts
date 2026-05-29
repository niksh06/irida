import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { cmdDoctor } from "../src/doctor.js";

function withKey(value: string | undefined, fn: () => void): void {
  const prev = process.env.CURSOR_API_KEY;
  if (value === undefined) delete process.env.CURSOR_API_KEY;
  else process.env.CURSOR_API_KEY = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prev;
  }
}

test("doctor fails without API key", () => {
  withKey(undefined, () => {
    const dir = mkdtempSync(resolve(tmpdir(), "doc-"));
    assert.equal(cmdDoctor(dir), 1);
  });
});

test("doctor passes with key + writable dir", () => {
  withKey("test-key", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "doc-"));
    assert.equal(cmdDoctor(dir), 0);
  });
});
