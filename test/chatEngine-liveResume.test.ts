import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openChatSession } from "../src/chatEngine.js";
import type { AgentLike, RunLike, SdkCreateLike, SdkResumeLike } from "../src/host.js";

async function withKey<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = "test-key";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prev;
  }
}

function okRun(): RunLike {
  return {
    stream: async function* () {
      yield { type: "text", text: "ok" };
    },
    wait: async () => ({ status: "finished", id: "r1" }),
  };
}

function seedSkill(dir: string): void {
  mkdirSync(join(dir, "skills"), { recursive: true });
  writeFileSync(
    join(dir, "skills", "foo.md"),
    "---\nname: foo\ndescription: d\n---\nUNIQUE_SKILL_BODY_12345"
  );
  writeFileSync(join(dir, "agent.config.json"), JSON.stringify({ skillsPath: "skills" }));
}

test("live resume skips skills on first turn after reopen", async () => {
  await withKey(async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "chat-resume-"));
    seedSkill(dir);

    const sent: string[] = [];
    const agentId = "agent-persist";
    const makeAgent = (): AgentLike => ({
      agentId,
      send: async (msg: string) => {
        sent.push(msg);
        return okRun();
      },
      close: async () => {},
    });

    let resumeCalled = false;
    const sdk: SdkCreateLike & SdkResumeLike = {
      create: async () => makeAgent(),
      resume: async (id) => {
        assert.equal(id, agentId);
        resumeCalled = true;
        return makeAgent();
      },
    };

    const opened1 = await openChatSession({ sdk, dir, skills: ["foo"], interactive: false });
    assert.equal(opened1.ok, true);
    if (!opened1.ok) return;
    assert.equal(opened1.session.connectMode, "fresh");
    const r1 = await opened1.session.sendTurn("first message");
    assert.equal(r1.kind, "ok");
    assert.match(sent[0] ?? "", /UNIQUE_SKILL_BODY_12345/);
    const sessionId = opened1.session.sessionId;
    await opened1.session.close();

    sent.length = 0;
    const opened2 = await openChatSession({
      sdk,
      dir,
      skills: ["foo"],
      resumeSessionId: sessionId,
      interactive: false,
    });
    assert.equal(opened2.ok, true);
    if (!opened2.ok) return;
    assert.equal(opened2.session.connectMode, "resumed");
    assert.equal(resumeCalled, true);
    await opened2.session.sendTurn("second message");
    assert.doesNotMatch(sent[0] ?? "", /UNIQUE_SKILL_BODY_12345/);
    assert.doesNotMatch(sent[0] ?? "", /# Skill: foo/);
    assert.match(sent[0] ?? "", /second message/);
    await opened2.session.close();
  });
});

test("transcript replay still injects skills on first turn", async () => {
  await withKey(async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "chat-replay-"));
    seedSkill(dir);

    const sent: string[] = [];
    const sdk: SdkCreateLike & SdkResumeLike = {
      create: async () => ({
        agentId: "agent-new",
        send: async (msg: string) => {
          sent.push(msg);
          return okRun();
        },
        close: async () => {},
      }),
      resume: async () => {
        throw new Error("Agent not found");
      },
    };

    const opened1 = await openChatSession({ sdk, dir, skills: ["foo"], interactive: false });
    assert.equal(opened1.ok, true);
    if (!opened1.ok) return;
    await opened1.session.sendTurn("seed turn");
    const sessionId = opened1.session.sessionId;
    await opened1.session.close();

    sent.length = 0;
    const opened2 = await openChatSession({
      sdk,
      dir,
      skills: ["foo"],
      resumeSessionId: sessionId,
      interactive: false,
    });
    assert.equal(opened2.ok, true);
    if (!opened2.ok) return;
    assert.equal(opened2.session.connectMode, "replayed");
    await opened2.session.sendTurn("after replay");
    assert.match(sent[0] ?? "", /UNIQUE_SKILL_BODY_12345/);
    assert.match(sent[0] ?? "", /Earlier in this session/);
    await opened2.session.close();
  });
});
