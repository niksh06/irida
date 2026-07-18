import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  addClaudeOAuthTokenToPool,
  markClaudeOAuthTokenInvalid,
  removeClaudeOAuthTokenFromPool,
  resolveClaudeOAuthToken,
  resolveClaudeOAuthTokenPool,
  saveClaudeOAuthToken,
  useClaudeOAuthTokenInPool,
} from "../src/credentials.js";
import { cmdAuth } from "../src/auth_cmd.js";
import { openChatSession } from "../src/chatEngine.js";
import type { AgentLike, RunLike, SdkCreateLike } from "../src/host.js";

function withCleanOAuthEnv(fn: () => void | Promise<void>): Promise<void> {
  const prev = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = prev;
  });
}

function okRun(): RunLike {
  return {
    stream: async function* () {
      yield { type: "text", text: "ok" };
    },
    wait: async () => ({ status: "finished", id: "r1" }),
  };
}

// ---- credentials.ts pool primitives ----

test("addClaudeOAuthTokenToPool: legacy single-token file is read as a 1-entry pool", async () => {
  await withCleanOAuthEnv(async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "oauth-pool-legacy-"));
    saveClaudeOAuthToken("legacy-bare-token", dir);
    // resolveClaudeOAuthToken behaves exactly as pre-pool code (I-169 backward compat).
    assert.deepEqual(resolveClaudeOAuthToken(dir), { key: "legacy-bare-token", source: "file" });
    const { pool, source } = resolveClaudeOAuthTokenPool(dir);
    assert.equal(source, "file");
    assert.equal(pool.length, 1);
    assert.equal(pool[0]!.token, "legacy-bare-token");
  });
});

test("addClaudeOAuthTokenToPool: pool grows, active token stays the first non-invalid entry", async () => {
  await withCleanOAuthEnv(async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "oauth-pool-add-"));
    const a = await addClaudeOAuthTokenToPool("sk-ant-oat-fixture-token-A", dir, "work");
    const b = await addClaudeOAuthTokenToPool("sk-ant-oat-fixture-token-B", dir);
    assert.notEqual(a.id, b.id);
    assert.equal(resolveClaudeOAuthToken(dir).key, "sk-ant-oat-fixture-token-A");
    const { pool } = resolveClaudeOAuthTokenPool(dir);
    assert.equal(pool.length, 2);
    assert.equal(pool[0]!.label, "work");
  });
});

test("addClaudeOAuthTokenToPool: rejects an exact duplicate", async () => {
  await withCleanOAuthEnv(async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "oauth-pool-dup-"));
    await addClaudeOAuthTokenToPool("sk-ant-oat-fixture-token-A", dir);
    await assert.rejects(() => addClaudeOAuthTokenToPool("sk-ant-oat-fixture-token-A", dir), /already in the pool/);
  });
});

test("markClaudeOAuthTokenInvalid: advances the active token to the next entry", async () => {
  await withCleanOAuthEnv(async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "oauth-pool-invalidate-"));
    await addClaudeOAuthTokenToPool("sk-ant-oat-fixture-token-A", dir);
    await addClaudeOAuthTokenToPool("sk-ant-oat-fixture-token-B", dir);
    assert.equal(resolveClaudeOAuthToken(dir).key, "sk-ant-oat-fixture-token-A");

    const marked = await markClaudeOAuthTokenInvalid("sk-ant-oat-fixture-token-A", dir);
    assert.equal(marked, true);
    assert.equal(resolveClaudeOAuthToken(dir).key, "sk-ant-oat-fixture-token-B");

    const { pool } = resolveClaudeOAuthTokenPool(dir);
    assert.ok(pool.find((e) => e.token === "sk-ant-oat-fixture-token-A")!.invalidAt);
  });
});

test("markClaudeOAuthTokenInvalid: no-op when the token isn't in the stored pool (e.g. env override)", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "oauth-pool-invalidate-miss-"));
  const marked = await markClaudeOAuthTokenInvalid("not-a-stored-token", dir);
  assert.equal(marked, false);
});

test("useClaudeOAuthTokenInPool: moves an entry to front and clears its invalid mark", async () => {
  await withCleanOAuthEnv(async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "oauth-pool-use-"));
    const a = await addClaudeOAuthTokenToPool("sk-ant-oat-fixture-token-A", dir);
    await addClaudeOAuthTokenToPool("sk-ant-oat-fixture-token-B", dir);
    await markClaudeOAuthTokenInvalid("sk-ant-oat-fixture-token-A", dir);
    assert.equal(resolveClaudeOAuthToken(dir).key, "sk-ant-oat-fixture-token-B");

    const used = await useClaudeOAuthTokenInPool(a.id, dir);
    assert.equal(used, true);
    assert.equal(resolveClaudeOAuthToken(dir).key, "sk-ant-oat-fixture-token-A");
    const { pool } = resolveClaudeOAuthTokenPool(dir);
    assert.equal(pool[0]!.token, "sk-ant-oat-fixture-token-A");
    assert.equal(pool[0]!.invalidAt, undefined);
  });
});

test("removeClaudeOAuthTokenFromPool: refuses to drop the last remaining token", async () => {
  await withCleanOAuthEnv(async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "oauth-pool-remove-last-"));
    const a = await addClaudeOAuthTokenToPool("sk-ant-oat-fixture-token-A", dir);
    await assert.rejects(() => removeClaudeOAuthTokenFromPool(a.id, dir), /refusing to remove the last token/);
  });
});

test("removeClaudeOAuthTokenFromPool: drops one of several", async () => {
  await withCleanOAuthEnv(async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "oauth-pool-remove-"));
    const a = await addClaudeOAuthTokenToPool("sk-ant-oat-fixture-token-A", dir);
    await addClaudeOAuthTokenToPool("sk-ant-oat-fixture-token-B", dir);
    const removed = await removeClaudeOAuthTokenFromPool(a.id, dir);
    assert.equal(removed, true);
    assert.equal(resolveClaudeOAuthToken(dir).key, "sk-ant-oat-fixture-token-B");
  });
});

test("env override still wins over the stored pool for resolution", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "oauth-pool-env-"));
  await addClaudeOAuthTokenToPool("sk-ant-oat-fixture-token-A", dir);
  const prev = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "env-token";
  try {
    assert.deepEqual(resolveClaudeOAuthToken(dir), { key: "env-token", source: "env" });
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = prev;
  }
});

// ---- CLI (irida auth claude token-add/token-list/token-use/token-remove) ----

test("cmdAuth claude token-add/token-list/token-use/token-remove", async () => {
  await withCleanOAuthEnv(async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "oauth-pool-cli-"));
    assert.equal(await cmdAuth(["claude", "token-add", "sk-ant-oat-fixture-cli-A", "--label", "work"], dir), 0);
    assert.equal(await cmdAuth(["claude", "token-add", "sk-ant-oat-fixture-cli-B"], dir), 0);

    const { pool } = resolveClaudeOAuthTokenPool(dir);
    assert.equal(pool.length, 2);

    assert.equal(await cmdAuth(["claude", "token-list"], dir), 0);

    assert.equal(await cmdAuth(["claude", "token-use", pool[1]!.id], dir), 0);
    assert.equal(resolveClaudeOAuthToken(dir).key, "sk-ant-oat-fixture-cli-B");

    assert.equal(await cmdAuth(["claude", "token-remove", pool[0]!.id], dir), 0);
    const after = resolveClaudeOAuthTokenPool(dir).pool;
    assert.equal(after.length, 1);
    assert.equal(after[0]!.token, "sk-ant-oat-fixture-cli-B");
  });
});

test("cmdAuth claude token-add: rejects a duplicate with a usage exit code", async () => {
  await withCleanOAuthEnv(async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "oauth-pool-cli-dup-"));
    assert.equal(await cmdAuth(["claude", "token-add", "sk-ant-oat-fixture-dup"], dir), 0);
    const code = await cmdAuth(["claude", "token-add", "sk-ant-oat-fixture-dup"], dir);
    assert.notEqual(code, 0);
  });
});

test("cmdAuth claude token-add: refuses a token-shaped --label value instead of silently swallowing it", async () => {
  await withCleanOAuthEnv(async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "oauth-pool-cli-label-guard-"));
    // The real mistake reported by the user: `token-add --stdin --label <the token itself>`.
    const code = await cmdAuth(
      ["claude", "token-add", "--stdin", "--label", "sk-ant-oat01-fixture-looks-like-a-real-token"],
      dir
    );
    assert.notEqual(code, 0);
    const { pool } = resolveClaudeOAuthTokenPool(dir);
    assert.equal(pool.length, 0, "nothing should have been persisted");
  });
});

test("addClaudeOAuthTokenToPool: rejects a whitespace-containing value (pasted command instead of a token)", async () => {
  await withCleanOAuthEnv(async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "oauth-pool-whitespace-guard-"));
    // The second real mistake reported by the user: the literal command line
    // (or an `export FOO=...` line) ended up piped in as the "token" value.
    await assert.rejects(
      () => addClaudeOAuthTokenToPool("npm run dev -- auth claude token-add --stdin --label work", dir),
      /contains whitespace/
    );
    const { pool } = resolveClaudeOAuthTokenPool(dir);
    assert.equal(pool.length, 0);
  });
});

// ---- chatEngine.ts: rotate-on-auth-error (I-169) ----

function claudeAgentConfig(dir: string): void {
  writeFileSync(
    resolve(dir, "agent.config.json"),
    JSON.stringify({ engine: { provider: "claude-agent", auth: "account" } })
  );
}

test("sendTurn: auth error on the active token rotates to the next pool entry and retries", async () => {
  await withCleanOAuthEnv(async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "oauth-pool-rotate-"));
    claudeAgentConfig(dir);
    await addClaudeOAuthTokenToPool("sk-ant-oat-fixture-token-A", dir);
    await addClaudeOAuthTokenToPool("sk-ant-oat-fixture-token-B", dir);

    const createApiKeys: string[] = [];
    let createCount = 0;
    const sdk: SdkCreateLike = {
      create: async (opts) => {
        createApiKeys.push(opts.apiKey);
        const myIndex = createCount++;
        const agent: AgentLike = {
          agentId: `agent-${myIndex}`,
          send: async () => {
            if (myIndex === 0) {
              throw new Error("OAuth token expired · run /login");
            }
            return okRun();
          },
          close: async () => {},
        };
        return agent;
      },
    };

    const opened = await openChatSession({ sdk, dir, interactive: false });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const outcome = await opened.session.sendTurn("hello");
    assert.equal(outcome.kind, "ok");
    await opened.session.close();

    // Two agents created: first with token-A (failed), second with token-B (succeeded).
    assert.deepEqual(createApiKeys, ["sk-ant-oat-fixture-token-A", "sk-ant-oat-fixture-token-B"]);

    const { pool } = resolveClaudeOAuthTokenPool(dir);
    assert.ok(pool.find((e) => e.token === "sk-ant-oat-fixture-token-A")!.invalidAt, "token-A must be marked invalid");
    assert.equal(pool.find((e) => e.token === "sk-ant-oat-fixture-token-B")!.invalidAt, undefined);
  });
});

test("sendTurn: auth error with only one pooled token does not rotate (unchanged pre-I-169 behavior)", async () => {
  await withCleanOAuthEnv(async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "oauth-pool-no-rotate-"));
    claudeAgentConfig(dir);
    await addClaudeOAuthTokenToPool("sk-ant-oat-fixture-only", dir);

    const createApiKeys: string[] = [];
    const sdk: SdkCreateLike = {
      create: async (opts) => {
        createApiKeys.push(opts.apiKey);
        const agent: AgentLike = {
          agentId: "agent-only",
          send: async () => {
            throw new Error("OAuth token expired · run /login");
          },
          close: async () => {},
        };
        return agent;
      },
    };

    const opened = await openChatSession({ sdk, dir, interactive: false });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const outcome = await opened.session.sendTurn("hello");
    assert.equal(outcome.kind, "error");
    if (outcome.kind === "error") {
      assert.match(outcome.message, /Authentication failed/);
    }
    await opened.session.close();

    // Only the initial agent — no rotation attempted (no alternate token).
    assert.deepEqual(createApiKeys, ["sk-ant-oat-fixture-only"]);
    const { pool } = resolveClaudeOAuthTokenPool(dir);
    // Still marked invalid — the auth error was real, even though there was nothing to fail over to.
    assert.ok(pool.find((e) => e.token === "sk-ant-oat-fixture-only")!.invalidAt);
  });
});
