import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { applyEngineAuthEnv, toAgentMcpServers } from "../src/engines/claudeAgentSdk.js";
import { loadConfig } from "../src/config.js";
import { createStore } from "../src/store.js";
import { cmdResume } from "../src/resume.js";
import { EXIT } from "../src/exit.js";

/** Snapshot + restore the two auth env vars around each case. */
function withCleanAuthEnv(fn: () => void): void {
  const prevApi = process.env.ANTHROPIC_API_KEY;
  const prevOauth = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  try {
    fn();
  } finally {
    if (prevApi === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevApi;
    if (prevOauth === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = prevOauth;
  }
}

test("applyEngineAuthEnv api-key: sets ANTHROPIC_API_KEY, clears OAuth token", () => {
  withCleanAuthEnv(() => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "stale-oauth";
    const restore = applyEngineAuthEnv("api-key", "sk-ant-xyz");
    assert.equal(process.env.ANTHROPIC_API_KEY, "sk-ant-xyz");
    assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
    restore();
    assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN, "stale-oauth");
  });
});

test("applyEngineAuthEnv account: sets OAuth token, clears API key", () => {
  withCleanAuthEnv(() => {
    process.env.ANTHROPIC_API_KEY = "stale-api-key";
    const restore = applyEngineAuthEnv("account", "oauth-tok");
    assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN, "oauth-tok");
    assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
    restore();
    assert.equal(process.env.ANTHROPIC_API_KEY, "stale-api-key");
  });
});

test("applyEngineAuthEnv account empty: clears API key, keeps inherited login token", () => {
  withCleanAuthEnv(() => {
    process.env.ANTHROPIC_API_KEY = "stale-api-key";
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "login-session-token";
    const restore = applyEngineAuthEnv("account", "");
    // API key cleared so it can't override account auth...
    assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
    // ...and the inherited `claude login` token is left intact.
    assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN, "login-session-token");
    restore();
    assert.equal(process.env.ANTHROPIC_API_KEY, "stale-api-key");
  });
});

test("toAgentMcpServers: maps stdio + http, drops malformed, empty → undefined", () => {
  const out = toAgentMcpServers({
    mem: { command: "node", args: ["x.js"], env: { A: "1" } },
    web: { url: "https://mcp.example/sse", headers: { X: "1" } },
    bad: { nope: true },
  }) as Record<string, unknown>;
  assert.deepEqual(out.mem, { type: "stdio", command: "node", args: ["x.js"], env: { A: "1" } });
  assert.deepEqual(out.web, { type: "http", url: "https://mcp.example/sse", headers: { X: "1" } });
  assert.equal("bad" in out, false);
  assert.equal(toAgentMcpServers(undefined), undefined);
  assert.equal(toAgentMcpServers({}), undefined);
});

test("resume guard: blocks cross-engine resume (offline, before any SDK call)", async () => {
  const prevApi = process.env.ANTHROPIC_API_KEY;
  const prevOauth = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  try {
    const dir = mkdtempSync(resolve(tmpdir(), "engine-guard-"));
    // active engine = claude-agent (account), but the stored session is a cursor session
    writeFileSync(
      resolve(dir, "agent.config.json"),
      JSON.stringify({ engine: { provider: "claude-agent", auth: "account" } })
    );
    const cfg = loadConfig(dir);
    const store = createStore(dir, cfg.stateDir);
    await store.upsertSession({
      id: "sess_cursor",
      title: "t",
      cwd: dir,
      runtime: "local",
      sdk_agent_id: "cursor-agent-id",
      engine: "cursor",
    });
    await store.close();

    // No sdk injected: if the guard didn't fire first, this would try the network.
    const code = await cmdResume("sess_cursor", "continue", { dir });
    assert.equal(code, EXIT.usage);
  } finally {
    if (prevApi === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevApi;
    if (prevOauth === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = prevOauth;
  }
});
