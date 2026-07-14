import { test } from "node:test";
import assert from "node:assert/strict";
import { redact } from "../src/redact.js";

test("redact leaves ordinary text untouched", () => {
  const text = "the meeting is at 5pm, bring the postgres notes";
  assert.equal(redact(text), text);
});

test("redact masks CURSOR_API_KEY assignment", () => {
  assert.equal(redact("CURSOR_API_KEY=abc123def456"), "CURSOR_API_KEY=<redacted>");
});

test("redact masks Bearer tokens", () => {
  assert.match(redact("Authorization: Bearer abcdef123456"), /Bearer <redacted>/);
});

test("redact masks telegram-bot-token shape", () => {
  assert.doesNotMatch(
    redact("token is 123456789:AAExampleTelegramBotToken1234"),
    /123456789:AAExampleTelegramBotToken1234/
  );
});

test("redact masks Anthropic/OpenAI sk- keys", () => {
  assert.doesNotMatch(redact("key=sk-ant-api03-abcdefghijklmnop"), /sk-ant-api03-abcdefghijklmnop/);
});

test("redact masks postgres/mysql/redis DSN passwords, keeps scheme+user+host", () => {
  const out = redact("conn: postgresql://irida:S3cretPass!@127.0.0.1:5435/irida_memory");
  assert.match(out, /postgresql:\/\/irida:<redacted>@127\.0\.0\.1:5435\/irida_memory/);
});

test("redact masks bare password= assignment", () => {
  assert.equal(redact("password=hunter2"), "password=<redacted>");
});

test("redact masks SNAKE_CASE secret env vars (I-162 fix — underscore boundary)", () => {
  assert.equal(redact("DB_PASSWORD=hunter2"), "DB_PASSWORD=<redacted>");
  assert.equal(
    redact("IRIDA_SECRETS_KEY=integration-test-secrets-key-32chars-long"),
    "IRIDA_SECRETS_KEY=<redacted>"
  );
  assert.equal(redact("GITHUB_TOKEN=ghp_exampleTokenValue123"), "GITHUB_TOKEN=<redacted>");
  assert.equal(
    redact("CLAUDE_CODE_OAUTH_TOKEN=cco_exampleValue123456"),
    "CLAUDE_CODE_OAUTH_TOKEN=<redacted>"
  );
});

test("redact does not mangle unrelated identifiers without a keyword segment", () => {
  assert.equal(redact("monkey=5"), "monkey=5");
});

test("redact masks AWS access key id, bare and via env-style assignment (I-162 fix)", () => {
  assert.doesNotMatch(redact("id: AKIAIOSFODNN7EXAMPLE"), /AKIAIOSFODNN7EXAMPLE/);
  assert.equal(
    redact("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE"),
    "AWS_ACCESS_KEY_ID=<redacted>"
  );
  assert.equal(
    redact("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY"),
    "AWS_SECRET_ACCESS_KEY=<redacted>"
  );
});

test("redact masks Stripe and Slack token shapes (I-162 fix)", () => {
  // Low-entropy placeholder suffixes (not a real key shape/value) — real-looking
  // random suffixes trip GitHub push-protection's secret scanner even in tests.
  assert.doesNotMatch(redact("stripe key sk_live_0000000000000000"), /sk_live_0000000000000000/);
  assert.doesNotMatch(redact("stripe key sk_test_0000000000000000"), /sk_test_0000000000000000/);
  assert.doesNotMatch(redact("slack token xoxb-0000000000-0000000000000"), /xoxb-0000000000-0000000000000/);
});

test("redact masks SSH/PEM private key blocks (I-162 fix)", () => {
  const pem = [
    "before",
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW",
    "-----END OPENSSH PRIVATE KEY-----",
    "after",
  ].join("\n");
  const out = redact(pem);
  assert.doesNotMatch(out, /AAAAABG5vbmUAAAAEbm9uZQ/);
  assert.match(out, /before/);
  assert.match(out, /after/);
});
