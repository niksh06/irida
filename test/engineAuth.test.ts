import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideClaudeAuth } from "../src/tui/engineAuth.js";

// I-156: /engine claude auth resolution. The bug: on cursor with no
// ANTHROPIC_API_KEY, switching to claude dead-ended even when `claude login`
// (account) was available.

describe("decideClaudeAuth (I-156)", () => {
  it("auto-falls to account when api-key is missing but a login exists", () => {
    const d = decideClaudeAuth({ hasApiKey: false, hasAccount: true });
    assert.equal(d.ok, true);
    assert.equal(d.ok && d.auth, "account");
    assert.match(d.ok ? d.note ?? "" : "", /account mode/);
  });

  it("uses api-key when the key is present", () => {
    const d = decideClaudeAuth({ hasApiKey: true, hasAccount: false });
    assert.deepEqual(d, { ok: true, auth: "api-key" });
  });

  it("explicit `account` hint is honored (no auto-note) and requires a login", () => {
    assert.deepEqual(decideClaudeAuth({ authHint: "account", hasApiKey: true, hasAccount: true }), {
      ok: true,
      auth: "account",
    });
    const miss = decideClaudeAuth({ authHint: "account", hasApiKey: true, hasAccount: false });
    assert.equal(miss.ok, false);
    assert.match(miss.ok ? "" : miss.error, /claude login/);
  });

  it("explicit `api-key` hint refuses when no key, does NOT silently use account", () => {
    const d = decideClaudeAuth({ authHint: "api-key", hasApiKey: false, hasAccount: true });
    assert.equal(d.ok, false);
    assert.match(d.ok ? "" : d.error, /ANTHROPIC_API_KEY/);
  });

  it("no credential at all → actionable error, not a dead-end", () => {
    const d = decideClaudeAuth({ hasApiKey: false, hasAccount: false });
    assert.equal(d.ok, false);
    assert.match(d.ok ? "" : d.error, /ANTHROPIC_API_KEY|claude login/);
  });

  it("config auth is honored over credential guessing", () => {
    // config says account, a login exists → account even though an api key also exists
    assert.equal(
      (decideClaudeAuth({ configAuth: "account", hasApiKey: true, hasAccount: true }) as { auth: string }).auth,
      "account"
    );
  });
});
