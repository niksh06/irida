import { test } from "node:test";
import assert from "node:assert/strict";
import { sendAgentTurn, type AgentLike, type RunLike } from "../src/host.js";
import {
  installGatewayProcessGuards,
  resetGatewayProcessGuardsForTests,
} from "../src/gatewayProcessGuards.js";

function okRun(): RunLike {
  return {
    wait: async () => ({ status: "finished", id: "r1" }),
  };
}

test("sendAgentTurn passes model on agent.send", async () => {
  let captured: unknown;
  const agent: AgentLike = {
    send: (msg, opts) => {
      assert.equal(msg, "hello");
      captured = opts;
      return okRun();
    },
  };
  await sendAgentTurn(agent, "hello", "composer-2.5");
  assert.deepEqual(captured, { model: { id: "composer-2.5" } });
});

test("sendAgentTurn forwards onDelta for token usage", async () => {
  let capturedDelta: unknown;
  const agent: AgentLike = {
    send: (_msg, opts) => {
      void opts?.onDelta?.({
        update: {
          type: "turn-ended",
          usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
        },
      });
      return okRun();
    },
  };
  await sendAgentTurn(agent, "hello", "composer-2.5", {
    onDelta: ({ update }) => {
      capturedDelta = update;
    },
  });
  assert.equal((capturedDelta as { type?: string }).type, "turn-ended");
});

test("installGatewayProcessGuards registers handlers once", () => {
  resetGatewayProcessGuardsForTests();
  const rejectBefore = process.listenerCount("unhandledRejection");
  const exceptBefore = process.listenerCount("uncaughtException");
  installGatewayProcessGuards();
  installGatewayProcessGuards();
  assert.equal(process.listenerCount("unhandledRejection"), rejectBefore + 1);
  assert.equal(process.listenerCount("uncaughtException"), exceptBefore + 1);
});
