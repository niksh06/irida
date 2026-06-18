import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildRedditFeedSnapshot,
  fetchAllRedditFeeds,
  formatRedditFeedSnapshot,
  parseRedditAtomFeed,
  redditDigestNoteName,
  REDDIT_FEED_DEFS,
} from "../src/redditRss.js";

const FIXTURE_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Test post one</title>
    <link href="https://www.reddit.com/r/cursor/comments/abc/test/" />
    <published>2026-06-17T10:00:00+00:00</published>
    <content type="html">&lt;p&gt;Hello world&lt;/p&gt;</content>
  </entry>
  <entry>
    <title>Old post</title>
    <link href="https://www.reddit.com/r/cursor/comments/old/" />
    <published>2026-06-10T10:00:00+00:00</published>
    <content type="html">stale</content>
  </entry>
</feed>`;

test("parseRedditAtomFeed extracts title link published", () => {
  const items = parseRedditAtomFeed(FIXTURE_ATOM, "cursor");
  assert.equal(items.length, 2);
  assert.equal(items[0]!.title, "Test post one");
  assert.match(items[0]!.link, /\/comments\/abc\//);
  assert.match(items[0]!.snippet, /Hello world/);
});

test("buildRedditFeedSnapshot filters by window", () => {
  const windowEnd = new Date("2026-06-17T12:00:00.000Z");
  const items = parseRedditAtomFeed(FIXTURE_ATOM, "cursor");
  const snapshot = buildRedditFeedSnapshot(items, 24, windowEnd);
  assert.equal(snapshot.totalPosts, 1);
  assert.equal(snapshot.items[0]!.title, "Test post one");
});

test("formatRedditFeedSnapshot includes subs and counts", () => {
  const windowEnd = new Date("2026-06-17T12:00:00.000Z");
  const items = parseRedditAtomFeed(FIXTURE_ATOM, "cursor");
  const snapshot = buildRedditFeedSnapshot(items, 24, windowEnd);
  const md = formatRedditFeedSnapshot(snapshot);
  assert.match(md, /Total posts: 1/);
  assert.match(md, /r\/cursor \(1\)/);
  assert.match(md, /Test post one/);
});

test("redditDigestNoteName uses UTC date", () => {
  assert.equal(
    redditDigestNoteName(new Date("2026-06-17T23:59:00.000Z")),
    "reddit-digest-2026-06-17"
  );
});

test("REDDIT_FEED_DEFS covers five subs from reddit-feeds", () => {
  assert.equal(REDDIT_FEED_DEFS.length, 5);
  assert.ok(REDDIT_FEED_DEFS.some((d) => d.sub === "cursor"));
  assert.ok(REDDIT_FEED_DEFS.every((d) => d.rssUrl.endsWith("/new.rss")));
});

test("fetchAllRedditFeeds uses fetchImpl mock", async () => {
  const windowEnd = new Date("2026-06-17T12:00:00.000Z");
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return new Response(FIXTURE_ATOM, { status: 200, headers: { "Content-Type": "application/atom+xml" } });
  };
  const snapshot = await fetchAllRedditFeeds(24, { fetchImpl, windowEnd, delayMs: 0 });
  assert.equal(calls, REDDIT_FEED_DEFS.length);
  assert.equal(snapshot.totalPosts, REDDIT_FEED_DEFS.length);
});

test("parseRedditAtomFeed drops non-http(s) links", () => {
  const xml = `<feed>
    <entry><title>ok</title><link href="https://reddit.com/r/x/1"/><published>2024-01-01T00:00:00Z</published><content>a</content></entry>
    <entry><title>evil</title><link href="javascript:alert(1)"/><published>2024-01-01T00:00:00Z</published><content>b</content></entry>
    <entry><title>file</title><link href="file:///etc/passwd"/><published>2024-01-01T00:00:00Z</published><content>c</content></entry>
  </feed>`;
  const items = parseRedditAtomFeed(xml, "x");
  assert.equal(items.length, 1);
  assert.equal(items[0]!.link, "https://reddit.com/r/x/1");
});

test("parseRedditAtomFeed caps entry count", () => {
  const entries = Array.from({ length: 250 }, (_, i) =>
    `<entry><title>t${i}</title><link href="https://reddit.com/r/x/${i}"/><published>2024-01-01T00:00:00Z</published><content>c</content></entry>`
  ).join("");
  const items = parseRedditAtomFeed(`<feed>${entries}</feed>`, "x");
  assert.ok(items.length <= 200);
});
