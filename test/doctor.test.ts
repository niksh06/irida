import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { cmdDoctor } from "../src/doctor.js";
import { gatherDoctorApiChecks } from "../src/doctorChecks.js";

function withKey(value: string | undefined, fn: () => void | Promise<void>): Promise<void> {
  const prev = process.env.CURSOR_API_KEY;
  if (value === undefined) delete process.env.CURSOR_API_KEY;
  else process.env.CURSOR_API_KEY = value;
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prev;
  });
}

test("doctor fails without API key", async () => {
  await withKey(undefined, async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "doc-"));
    assert.equal(await cmdDoctor(dir), 1);
  });
});

test("doctor passes with key + writable dir + models API", async () => {
  await withKey("test-key", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "doc-"));
    assert.equal(
      await cmdDoctor(dir, {
        listModels: async () => [{ id: "composer-2.5" }, { id: "gpt-5.4" }],
      }),
      0
    );
  });
});

test("doctor fails when models API rejects key", async () => {
  await withKey("bad-key", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "doc-bad-"));
    assert.equal(
      await cmdDoctor(dir, {
        listModels: async () => {
          throw Object.assign(new Error("Authentication failed"), { code: 16 });
        },
      }),
      1
    );
  });
});

test("gatherDoctorApiChecks skips when key unset", async () => {
  await withKey(undefined, async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "doc-nocred-"));
    assert.deepEqual(await gatherDoctorApiChecks(dir), []);
  });
});

test("gatherDoctorApiChecks reports model count", async () => {
  await withKey("k", async () => {
    const checks = await gatherDoctorApiChecks(".", {
      listModels: async () => [{ id: "a" }, { id: "b" }],
    });
    assert.equal(checks.length, 1);
    assert.equal(checks[0]?.ok, true);
    assert.match(checks[0]?.detail ?? "", /2 model/);
  });
});
