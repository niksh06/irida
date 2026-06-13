import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapeTelegramHtml,
  formatTelegramHtml,
  telegramHtmlDiffers,
} from "../src/telegramFormat.js";

test("escapes html entities", () => {
  assert.equal(escapeTelegramHtml("a < b & c > d"), "a &lt; b &amp; c &gt; d");
});

test("converts bold, code, links", () => {
  const out = formatTelegramHtml("**Топ**: `csagent` — [docs](https://example.com/x?a=1)");
  assert.equal(out, '<b>Топ</b>: <code>csagent</code> — <a href="https://example.com/x?a=1">docs</a>');
});

test("fenced code block becomes pre and is not inline-processed", () => {
  const out = formatTelegramHtml("before\n```bash\nrm -rf **not bold** <tag>\n```\nafter");
  assert.match(out, /<pre><code class="language-bash">rm -rf \*\*not bold\*\* &lt;tag&gt;<\/code><\/pre>/);
  assert.doesNotMatch(out, /<b>not bold<\/b>/);
});

test("user html in text is escaped (injection-safe)", () => {
  const out = formatTelegramHtml('<script>alert("x")</script> **b**');
  assert.match(out, /^&lt;script&gt;/);
  assert.match(out, /<b>b<\/b>/);
});

test("telegramHtmlDiffers false for plain text", () => {
  const plain = "no markdown here < just text";
  assert.equal(telegramHtmlDiffers(plain, formatTelegramHtml(plain)), false);
  const md = "**bold**";
  assert.equal(telegramHtmlDiffers(md, formatTelegramHtml(md)), true);
});

test("converts italic, strike, spoiler, blockquote, fenced language", () => {
  const out = formatTelegramHtml(
    "*italic* and _also_\n> quoted **bold**\n~~gone~~ ||secret||\n```py\nx = 1\n```"
  );
  assert.match(out, /<i>italic<\/i>/);
  assert.match(out, /<i>also<\/i>/);
  assert.match(out, /<blockquote>quoted <b>bold<\/b><\/blockquote>/);
  assert.match(out, /<s>gone<\/s>/);
  assert.match(out, /<tg-spoiler>secret<\/tg-spoiler>/);
  assert.match(out, /class="language-py"/);
});
