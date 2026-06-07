import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { cmdRun } from "../src/run.js";
import { cmdDoctor } from "../src/doctor.js";
import type { SdkLike } from "../src/host.js";

function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), "mcp-"));
}

async function withKey<T>(value: string | undefined, fn: () => Promise<T> | T): Promise<T> {
  const prev = process.env.CURSOR_API_KEY;
  if (value === undefined) delete process.env.CURSOR_API_KEY;
  else process.env.CURSOR_API_KEY = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prev;
  }
}

test("run passes mcpServers and injected skill to SDK", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    writeFileSync(
      join(dir, "agent.config.json"),
      JSON.stringify({ mcpServers: { srv: { command: "echo" } } })
    );
    const sk = join(dir, "skills");
    mkdirSync(sk, { recursive: true });
    writeFileSync(join(sk, "foo.md"), "---\nname: foo\ndescription: d\n---\nFOO BODY");

    const cap: { msg?: string; opts?: Record<string, unknown> } = {};
    const sdk: SdkLike = {
      prompt: async (msg, opts) => {
        cap.msg = msg;
        cap.opts = opts as Record<string, unknown>;
        return { status: "finished", result: "ok", id: "r1" };
      },
    };
    const code = await cmdRun("do it", { sdk, dir, skills: ["foo"] });
    assert.equal(code, 0);
    const mcp = cap.opts?.mcpServers as Record<string, { command?: string }> | undefined;
    assert.equal(mcp?.srv?.command, "echo");
    assert.match(cap.msg ?? "", /# Skill: foo/);
    assert.match(cap.msg ?? "", /FOO BODY/);
  });
});

test("doctor fails on invalid mcp config", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "agent.config.json"), JSON.stringify({ mcpServers: { bad: {} } }));
    assert.equal(await cmdDoctor(dir), 1);
  });
});

test("doctor passes with valid mcp config", async () => {
  await withKey("crsr_" + "a".repeat(24), async () => {
    const dir = tmp();
    writeFileSync(
      join(dir, "agent.config.json"),
      JSON.stringify({ mcpServers: { web: { url: "http://localhost:9" } } })
    );
    assert.equal(
      await cmdDoctor(dir, { listModels: async () => [{ id: "composer-2.5" }] }),
      0
    );
  });
});
