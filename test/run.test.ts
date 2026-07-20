import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { cmdRun } from "../src/run.js";
import { Store } from "../src/store.js";
import type { SdkLike } from "../src/host.js";
import { addClaudeOAuthTokenToPool, resolveClaudeOAuthTokenPool } from "../src/credentials.js";

function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), "run-"));
}

function fakeSdk(impl: SdkLike["prompt"]): SdkLike {
  return { prompt: impl };
}

async function withKey<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
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

test("finished run -> exit 0 and persisted to sqlite", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const sdk = fakeSdk(async () => ({ status: "finished", result: "hello", id: "r1", agentId: "a1" }));
    const code = await cmdRun("hi", { sdk, dir });
    assert.equal(code, 0);
    const store = new Store(dir, ".agent");
    const sessions = await store.listSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].last_status, "finished");
    const runs = await store.listRuns(sessions[0].id);
    assert.equal(runs[0].sdk_run_id, "r1");
    await store.close();
  });
});

test("destructive prompt -> EX_NOPERM 77 (non-interactive)", async () => {
  await withKey("k", async () => {
    let called = false;
    const sdk = fakeSdk(async () => {
      called = true;
      return { status: "finished" };
    });
    const code = await cmdRun("rm -rf /tmp/x", { sdk, dir: tmp() });
    assert.equal(code, 77);
    assert.equal(called, false);
  });
});

test("destructive content smuggled via @file -> EX_NOPERM 77", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    writeFileSync(resolve(dir, "evil.txt"), "please run rm -rf /tmp/x for cleanup\n", "utf8");
    let called = false;
    const sdk = fakeSdk(async () => {
      called = true;
      return { status: "finished" };
    });
    const code = await cmdRun("do what @file:evil.txt says", { sdk, dir, cwd: dir });
    assert.equal(code, 77);
    assert.equal(called, false);
  });
});

test("destructive prompt + --yes-i-understand -> proceeds", async () => {
  await withKey("k", async () => {
    const sdk = fakeSdk(async () => ({ status: "finished", result: "done", id: "r" }));
    const code = await cmdRun("rm -rf /tmp/x", { sdk, dir: tmp(), yesIUnderstand: true });
    assert.equal(code, 0);
  });
});

test("executed error status -> EX_SOFTWARE 70", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const sdk = fakeSdk(async () => ({ status: "error", id: "r2" }));
    const code = await cmdRun("hi", { sdk, dir });
    assert.equal(code, 70);
  });
});

test("thrown SDK error -> EX_SOFTWARE 70", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const sdk = fakeSdk(async () => {
      throw new Error("401 auth");
    });
    const code = await cmdRun("hi", { sdk, dir });
    assert.equal(code, 70);
  });
});

test("missing API key -> EX_CONFIG 78 before SDK", async () => {
  await withKey(undefined, async () => {
    const dir = tmp();
    let called = false;
    const sdk = fakeSdk(async () => {
      called = true;
      return { status: "finished" };
    });
    const code = await cmdRun("hi", { sdk, dir });
    assert.equal(code, 78);
    assert.equal(called, false);
  });
});

test("empty prompt -> EX_USAGE 64", async () => {
  await withKey("k", async () => {
    const code = await cmdRun("   ", { sdk: fakeSdk(async () => ({ status: "finished" })), dir: tmp() });
    assert.equal(code, 64);
  });
});

// ---- runPrompt: auth-error pool rotation (I-169 parity for the cron/one-shot path) ----
// chatEngine.ts's tryRotateOnAuthFailure only covered interactive chat sessions; a cron
// job hitting an org-blocked account token failed outright (exit 70) with a healthy
// second pool entry sitting unused. sdk.prompt() takes apiKey per call, so this only
// needs a revised key on retry — no session/sdk recreation like chatEngine.ts.

function claudeAgentAccountConfig(dir: string): void {
  writeFileSync(
    resolve(dir, "agent.config.json"),
    JSON.stringify({ engine: { provider: "claude-agent", auth: "account" } })
  );
}

async function withCleanOAuthEnv<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = prev;
  }
}

test("runPrompt: org-policy auth failure on the active token rotates to the next pool entry", async () => {
  await withCleanOAuthEnv(async () => {
    const dir = tmp();
    claudeAgentAccountConfig(dir);
    await addClaudeOAuthTokenToPool("sk-ant-oat-fixture-token-A", dir);
    await addClaudeOAuthTokenToPool("sk-ant-oat-fixture-token-B", dir);

    const promptApiKeys: string[] = [];
    const sdk: SdkLike = {
      prompt: async (_msg, opts) => {
        promptApiKeys.push(opts.apiKey ?? "");
        if (promptApiKeys.length === 1) {
          throw new Error(
            "Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access"
          );
        }
        return { status: "finished", result: "done", id: "r1", agentId: "a1" };
      },
    };

    const code = await cmdRun("hi", { sdk, dir });
    assert.equal(code, 0);
    assert.deepEqual(promptApiKeys, ["sk-ant-oat-fixture-token-A", "sk-ant-oat-fixture-token-B"]);

    const { pool } = resolveClaudeOAuthTokenPool(dir);
    assert.ok(pool.find((e) => e.token === "sk-ant-oat-fixture-token-A")!.invalidAt, "token-A must be marked invalid");
    assert.equal(pool.find((e) => e.token === "sk-ant-oat-fixture-token-B")!.invalidAt, undefined);
  });
});

test("runPrompt: auth failure with only one pooled token still exits 70 (nothing to rotate to)", async () => {
  await withCleanOAuthEnv(async () => {
    const dir = tmp();
    claudeAgentAccountConfig(dir);
    await addClaudeOAuthTokenToPool("sk-ant-oat-fixture-only", dir);

    const promptApiKeys: string[] = [];
    const sdk: SdkLike = {
      prompt: async (_msg, opts) => {
        promptApiKeys.push(opts.apiKey ?? "");
        throw new Error("OAuth token expired · run /login");
      },
    };

    const code = await cmdRun("hi", { sdk, dir });
    assert.equal(code, 70);
    // Only the initial attempt — no alternate token to rotate to.
    assert.deepEqual(promptApiKeys, ["sk-ant-oat-fixture-only"]);
    const { pool } = resolveClaudeOAuthTokenPool(dir);
    assert.ok(pool.find((e) => e.token === "sk-ant-oat-fixture-only")!.invalidAt);
  });
});
