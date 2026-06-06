import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessGatewayLogHealth,
  assessGatewayServiceHealth,
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

test("assessGatewayServiceHealth ok when stdout healthy despite stale stderr poll errors", () => {
  const h = assessGatewayServiceHealth({
    infoLines: ["[gateway] telegram long-poll started (interval=500ms)"],
    errorLines: ["[gateway] telegram poll error (#14): Not Found; retry in 60000ms"],
    infoAgeMs: 30_000,
    errorAgeMs: 30_000,
    gatewayRunning: true,
  });
  assert.equal(h.ok, true);
  assert.match(h.detail, /long-poll started/);
});

test("telegramPollRetryDelayMs honors retry after seconds", () => {
  assert.equal(
    telegramPollRetryDelayMs("Too Many Requests: retry after 5", 1, 1500, 60_000),
    5000
  );
});
