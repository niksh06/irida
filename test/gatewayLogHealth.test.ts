import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessGatewayLogHealth,
  GATEWAY_LOG_STALE_MS,
} from "../src/gatewayLogHealth.js";
import { telegramPollRetryDelayMs } from "../src/gatewayTelegram.js";

test("assessGatewayLogHealth fails on stale log while running", () => {
  const h = assessGatewayLogHealth({
    tailLines: ["[gateway] telegram poll error: Bad Gateway"],
    ageMs: GATEWAY_LOG_STALE_MS + 60_000,
    gatewayRunning: true,
    stream: "stderr",
  });
  assert.equal(h.ok, false);
  assert.match(h.detail, /stale/);
  assert.match(h.hint ?? "", /install-launchd/);
});

test("assessGatewayLogHealth fails when tail is only poll errors", () => {
  const h = assessGatewayLogHealth({
    tailLines: [
      "[gateway] telegram poll error: Too Many Requests: retry after 5",
      "[gateway] telegram poll error: Bad Gateway",
    ],
    ageMs: 5 * 60_000,
    gatewayRunning: true,
    stream: "stderr",
  });
  assert.equal(h.ok, false);
  assert.match(h.hint ?? "", /poll failing/);
});

test("assessGatewayLogHealth ok on recent long-poll started", () => {
  const h = assessGatewayLogHealth({
    tailLines: ["[gateway] telegram long-poll started (interval=1500ms)"],
    ageMs: 60_000,
    gatewayRunning: true,
    stream: "stderr",
  });
  assert.equal(h.ok, true);
});

test("telegramPollRetryDelayMs honors retry after seconds", () => {
  assert.equal(
    telegramPollRetryDelayMs("Too Many Requests: retry after 5", 1, 1500, 60_000),
    5000
  );
});
