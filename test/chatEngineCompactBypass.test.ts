import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { saveMemory } from "../src/memory.js";
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

test("/compact reaches the SDK verbatim on a live-resumed session (skips mode/profile/memory blocks)", async () => {
  await withKey(async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "chat-compact-resumed-"));
    saveMemory(dir, "user-profile.niksh", "UNIQUE_PROFILE_COMPACT_111");
    writeFileSync(
      join(dir, "agent.config.json"),
      JSON.stringify({ memory: { preTurn: { profileNote: "user-profile.niksh" } } })
    );

    const sent: string[] = [];
    const agentId = "agent-compact";
    const makeAgent = (): AgentLike => ({
      agentId,
      send: async (msg: string) => {
        sent.push(msg);
        return okRun();
      },
      close: async () => {},
    });
    const sdk: SdkCreateLike & SdkResumeLike = {
      create: async () => makeAgent(),
      resume: async () => makeAgent(),
    };

    const opened1 = await openChatSession({ sdk, dir, interactive: false });
    assert.equal(opened1.ok, true);
    if (!opened1.ok) return;
    await opened1.session.sendTurn("hello");
    const sessionId = opened1.session.sessionId;
    await opened1.session.close();

    sent.length = 0;
    const opened2 = await openChatSession({ sdk, dir, resumeSessionId: sessionId, interactive: false });
    assert.equal(opened2.ok, true);
    if (!opened2.ok) return;
    assert.equal(opened2.session.connectMode, "resumed");
    await opened2.session.sendTurn("/compact");
    assert.equal(sent[0], "/compact", "must be the bare command, no wrapping");
    await opened2.session.close();
  });
});

test("/compact bypasses skills injection even on a brand-new session's first turn", async () => {
  await withKey(async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "chat-compact-fresh-"));
    seedSkill(dir);

    const sent: string[] = [];
    const sdk: SdkCreateLike = {
      create: async () => ({
        agentId: "agent-fresh",
        send: async (msg: string) => {
          sent.push(msg);
          return okRun();
        },
        close: async () => {},
      }),
    };

    const opened = await openChatSession({ sdk, dir, skills: ["foo"], interactive: false });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    await opened.session.sendTurn("/compact");
    assert.equal(sent[0], "/compact");
    await opened.session.close();
  });
});

test("/compact bypasses the transcript-replay prefix (connectMode 'replayed')", async () => {
  await withKey(async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "chat-compact-replay-"));
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
    await opened2.session.sendTurn("/compact");
    assert.equal(sent[0], "/compact", "replay prefix must not wrap /compact");
    assert.doesNotMatch(sent[0] ?? "", /Earlier in this session/);
    await opened2.session.close();
  });
});

test("/compact with trailing instructions still bypasses composition, verbatim", async () => {
  await withKey(async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "chat-compact-args-"));
    const sent: string[] = [];
    const sdk: SdkCreateLike = {
      create: async () => ({
        agentId: "agent-args",
        send: async (msg: string) => {
          sent.push(msg);
          return okRun();
        },
        close: async () => {},
      }),
    };
    const opened = await openChatSession({ sdk, dir, interactive: false });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    await opened.session.sendTurn("/compact keep the auth discussion");
    assert.equal(sent[0], "/compact keep the auth discussion");
    await opened.session.close();
  });
});

test("a message that merely starts with 'compact' text is not mistaken for the command", async () => {
  await withKey(async () => {
    // Absence-of-injection is not a strong enough signal (composePrompt is a
    // no-op when there's nothing to inject) — use a first-turn profile excerpt
    // as a positive marker that normal composition actually ran.
    const dir = mkdtempSync(resolve(tmpdir(), "chat-compact-negative-"));
    saveMemory(dir, "user-profile.niksh", "UNIQUE_PROFILE_NEGATIVE_222");
    writeFileSync(
      join(dir, "agent.config.json"),
      JSON.stringify({ memory: { preTurn: { profileNote: "user-profile.niksh" } } })
    );
    const sent: string[] = [];
    const sdk: SdkCreateLike = {
      create: async () => ({
        agentId: "agent-negative",
        send: async (msg: string) => {
          sent.push(msg);
          return okRun();
        },
        close: async () => {},
      }),
    };
    const opened = await openChatSession({ sdk, dir, interactive: false });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    // "/compacted" must NOT trip the bypass (word-boundary check on isCompactCommand).
    await opened.session.sendTurn("/compacted the files already");
    assert.match(sent[0] ?? "", /UNIQUE_PROFILE_NEGATIVE_222/, "normal composition should have run (profile injected)");
    assert.match(sent[0] ?? "", /compacted the files already/);
    await opened.session.close();
  });
});
