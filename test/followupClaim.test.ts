import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  addFollowup,
  claimFollowup,
  loadFollowups,
  saveFollowups,
  FOLLOWUP_CLAIM_TTL_MS,
} from "../src/gatewayFollowupStore.js";
import { runDueFollowups } from "../src/gatewayFollowups.js";
import { loadOutbox } from "../src/gatewayOutbox.js";

// I-139 (audit H-4): runDueFollowups runs outside the cron lock and clears the
// entry only AFTER a minutes-long agent run — overlapping runners double-fired
// a followup (duplicate Telegram message + double token spend). A claim mark
// written BEFORE firing closes the window.

function tmp(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "fu-claim-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  return dir;
}

/** A followup that is due `now` (addFollowup enforces >=1 min delays). */
function addDueFollowup(dir: string): { id: string; now: Date } {
  const added = addFollowup(dir, { chatId: "42", adapter: "telegram", reason: "check the build", afterMinutes: 1 });
  assert.equal(added.ok, true);
  return { id: added.followup!.id, now: new Date(Date.now() + 2 * 60_000) };
}

test("claimFollowup: fresh claim blocks, stale claim is reclaimable", () => {
  const dir = tmp();
  const { id, now } = addDueFollowup(dir);
  assert.equal(claimFollowup(dir, id, now), true);
  assert.equal(claimFollowup(dir, id, now), false); // fresh claim held
  const later = new Date(now.getTime() + FOLLOWUP_CLAIM_TTL_MS + 1000);
  assert.equal(claimFollowup(dir, id, later), true); // crashed runner reclaimed
  assert.equal(claimFollowup(dir, "fu_nope", now), false); // unknown id
});

test("overlapping runDueFollowups fire a followup exactly once", async () => {
  const dir = tmp();
  const { now } = addDueFollowup(dir);
  const ran: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));

  // Runner A claims the followup, then hangs mid-run (the real window).
  const pA = runDueFollowups({
    dir,
    now,
    onLog: () => {},
    runner: async () => {
      ran.push("A");
      await gate;
      return { exitCode: 0, text: "done by A" };
    },
  });
  await new Promise((r) => setTimeout(r, 50));

  // Runner B overlaps (manual `cron tick` next to launchd) — must skip the claim.
  const outB = await runDueFollowups({
    dir,
    now,
    onLog: () => {},
    runner: async () => {
      ran.push("B");
      return { exitCode: 0, text: "done by B" };
    },
  });
  assert.deepEqual(outB.fired, []);
  assert.deepEqual(ran, ["A"]);

  release();
  const outA = await pA;
  assert.equal(outA.fired.length, 1);
  assert.equal(loadFollowups(dir).followups.length, 0); // one-shot clear intact
  assert.equal(loadOutbox(dir).entries.length, 1); // exactly ONE delivery
  assert.match(loadOutbox(dir).entries[0]!.text, /done by A/);
});

test("a stale claim from a crashed runner does not orphan the followup", async () => {
  const dir = tmp();
  const { id, now } = addDueFollowup(dir);
  // Simulate a runner that claimed and died 20 minutes ago.
  const file = loadFollowups(dir);
  file.followups[0]!.firing = new Date(now.getTime() - 20 * 60_000).toISOString();
  saveFollowups(dir, file);
  const out = await runDueFollowups({
    dir,
    now,
    onLog: () => {},
    runner: async () => ({ exitCode: 0, text: "recovered" }),
  });
  assert.deepEqual(out.fired, [id]);
});
