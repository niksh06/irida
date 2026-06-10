import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connectAgentForSession } from "../src/sessionConnect.js";
import { loadConfig } from "../src/config.js";
import { Store } from "../src/store.js";
import type { AgentLike, SdkCreateLike, SdkResumeLike } from "../src/host.js";

test("connectAgentForSession passes model on live resume", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sessconn-"));
  const cfg = loadConfig(dir);
  const store = new Store(dir, cfg.stateDir);
  await store.upsertSession({
    id: "sess_1",
    title: "t",
    cwd: dir,
    runtime: cfg.runtime,
    sdk_agent_id: "agent-live",
    last_status: "created",
    channel: "telegram",
  });

  let resumeOpts: unknown;
  const sdk: SdkCreateLike & SdkResumeLike = {
    resume: async (_id, opts) => {
      resumeOpts = opts;
      return { agentId: "agent-live", send: () => ({ wait: async () => ({ status: "finished" }) }) };
    },
    create: async () => {
      throw new Error("should not create when live resume succeeds");
    },
  };

  const session = (await store.getSession("sess_1"))!;
  const result = await connectAgentForSession(sdk, store, session, cfg, "key", {});
  assert.equal(result.mode, "resumed");
  assert.deepEqual((resumeOpts as { model?: { id: string } }).model, { id: cfg.model });
  await store.close();
});
