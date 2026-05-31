import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatSeenPostsBlock,
  isPostSeen,
  markPostSeen,
  listSeenPosts,
  SEEN_POST_SUBJECT,
} from "../src/memoryDedup.js";

test("seen_post dedup via memory facts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dedup-"));
  assert.equal(await isPostSeen(dir, "ch1", "99"), false);
  await markPostSeen(dir, "ch1", "99", "test");
  assert.equal(await isPostSeen(dir, "ch1", "99"), true);
  assert.equal(await isPostSeen(dir, "ch1", "100"), false);
  const all = await listSeenPosts(dir);
  assert.equal(all.length, 1);
  assert.equal(all[0]!.subject, SEEN_POST_SUBJECT);
  const block = formatSeenPostsBlock(all);
  assert.match(block, /ch1:99/);
});
