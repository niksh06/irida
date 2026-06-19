import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEngineAuthEnv } from "../src/engines/claudeAgentSdk.js";

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
