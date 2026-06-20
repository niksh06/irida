/**
 * Reddit RSS fetch for reddit-digest-daily cron (I-77).
 */
export interface RedditFeedDef {
  sub: string;
  rssUrl: string;
}

/** Matches ~/.csagent/.agent/memory/reddit-feeds.md sub list. */
export const REDDIT_FEED_DEFS: RedditFeedDef[] = [
  { sub: "LocalLLM", rssUrl: "https://www.reddit.com/r/LocalLLM/new.rss" },
  { sub: "LocalLLaMA", rssUrl: "https://www.reddit.com/r/LocalLLaMA/new.rss" },
  { sub: "cursor", rssUrl: "https://www.reddit.com/r/cursor/new.rss" },
  { sub: "CursorAI", rssUrl: "https://www.reddit.com/r/CursorAI/new.rss" },
  { sub: "Rag", rssUrl: "https://www.reddit.com/r/Rag/new.rss" },
];

export const REDDIT_RSS_USER_AGENT = "irida/0.2 reddit-rss-fetch (personal digest; +https://github.com/niksh06/csagent)";

export interface RedditRssItem {
  sub: string;
  title: string;
  link: string;
  published: Date;
  snippet: string;
}

export interface RedditFeedSnapshot {
  windowHours: number;
  windowStart: string;
  windowEnd: string;
  items: RedditRssItem[];
  totalPosts: number;
  errors: string[];
}

export type RedditFetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function stripHtml(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** Cap entries parsed per feed — a hostile/large feed must not blow up memory. */
export const REDDIT_FEED_MAX_ENTRIES = 200;

/** Parse Reddit Atom /new.rss entries (best-effort, no XML dependency). */
export function parseRedditAtomFeed(xml: string, sub: string): RedditRssItem[] {
  const items: RedditRssItem[] = [];
  const entryRe = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
  let match: RegExpExecArray | null;
  while ((match = entryRe.exec(xml)) !== null) {
    if (items.length >= REDDIT_FEED_MAX_ENTRIES) break;
    const block = match[1]!;
    const titleMatch = block.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link[^>]*href="([^"]+)"/i);
    const publishedMatch =
      block.match(/<published>([^<]+)<\/published>/i) ??
      block.match(/<updated>([^<]+)<\/updated>/i);
    const contentMatch =
      block.match(/<content[^>]*>([\s\S]*?)<\/content>/i) ??
      block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
    if (!titleMatch || !linkMatch || !publishedMatch) continue;
    // Only http/https links reach the digest — drop javascript:/file:/data: etc.
    const link = decodeXmlEntities(linkMatch[1]!).trim();
    if (!/^https?:\/\//i.test(link)) continue;
    const published = new Date(publishedMatch[1]!.trim());
    if (Number.isNaN(published.getTime())) continue;
    items.push({
      sub,
      title: decodeXmlEntities(titleMatch[1]!),
      link,
      published,
      snippet: stripHtml(contentMatch?.[1] ?? "").slice(0, 280),
    });
  }
  return items;
}

export function filterItemsByWindow(items: RedditRssItem[], windowStart: Date): RedditRssItem[] {
  const startMs = windowStart.getTime();
  return items.filter((item) => item.published.getTime() >= startMs);
}

export function buildRedditFeedSnapshot(
  items: RedditRssItem[],
  windowHours: number,
  windowEnd: Date = new Date(),
  errors: string[] = []
): RedditFeedSnapshot {
  const windowStart = new Date(windowEnd.getTime() - windowHours * 3600_000);
  const filtered = filterItemsByWindow(items, windowStart).sort(
    (a, b) => b.published.getTime() - a.published.getTime()
  );
  return {
    windowHours,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    items: filtered,
    totalPosts: filtered.length,
    errors,
  };
}

const REDDIT_RSS_RETRY_DELAYS_MS = [2_500, 6_000];

/** Max feed body we will buffer — guards against a hostile multi-GB response. */
export const REDDIT_RSS_MAX_BYTES = 8 * 1024 * 1024;

/** Read a response body up to a byte cap, aborting (throwing) if exceeded. */
async function readCappedText(res: Response, maxBytes: number): Promise<string> {
  const lenHeader = Number(res.headers.get("content-length"));
  if (Number.isFinite(lenHeader) && lenHeader > maxBytes) {
    throw new Error(`feed body too large (${lenHeader} bytes > ${maxBytes})`);
  }
  const body = res.body;
  if (!body) return (await res.text()).slice(0, maxBytes);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`feed body too large (> ${maxBytes} bytes)`);
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

export async function fetchRedditSubFeed(
  def: RedditFeedDef,
  windowStart: Date,
  fetchImpl: RedditFetchFn = fetch,
  timeoutMs = 20_000
): Promise<{ items: RedditRssItem[]; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    "User-Agent": REDDIT_RSS_USER_AGENT,
    Accept: "application/atom+xml, application/xml, text/xml, */*",
  };
  try {
    let res: Response | undefined;
    for (let attempt = 0; attempt <= REDDIT_RSS_RETRY_DELAYS_MS.length; attempt++) {
      res = await fetchImpl(def.rssUrl, { signal: controller.signal, headers });
      if (res.status !== 429) break;
      const wait = REDDIT_RSS_RETRY_DELAYS_MS[attempt];
      if (wait == null) break;
      await new Promise((r) => setTimeout(r, wait));
    }
    if (!res || !res.ok) {
      return { items: [], error: `${def.sub}: HTTP ${res?.status ?? "unknown"}` };
    }
    const xml = await readCappedText(res, REDDIT_RSS_MAX_BYTES);
    const parsed = parseRedditAtomFeed(xml, def.sub);
    return { items: filterItemsByWindow(parsed, windowStart) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { items: [], error: `${def.sub}: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAllRedditFeeds(
  windowHours = 24,
  opts: { fetchImpl?: RedditFetchFn; windowEnd?: Date; delayMs?: number } = {}
): Promise<RedditFeedSnapshot> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const windowEnd = opts.windowEnd ?? new Date();
  const windowStart = new Date(windowEnd.getTime() - windowHours * 3600_000);
  const delayMs = opts.delayMs ?? 2_500;
  const all: RedditRssItem[] = [];
  const errors: string[] = [];

  for (let i = 0; i < REDDIT_FEED_DEFS.length; i++) {
    const def = REDDIT_FEED_DEFS[i]!;
    const result = await fetchRedditSubFeed(def, windowStart, fetchImpl);
    all.push(...result.items);
    if (result.error) errors.push(result.error);
    if (i + 1 < REDDIT_FEED_DEFS.length && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return buildRedditFeedSnapshot(all, windowHours, windowEnd, errors);
}

export function formatRedditFeedSnapshot(snapshot: RedditFeedSnapshot): string {
  const lines = [
    "# Reddit RSS snapshot",
    "",
    `Window: last ${snapshot.windowHours}h UTC`,
    `From: ${snapshot.windowStart}`,
    `To: ${snapshot.windowEnd}`,
    `Total posts: ${snapshot.totalPosts}`,
  ];
  if (snapshot.errors.length) {
    lines.push(`Fetch errors: ${snapshot.errors.join("; ")}`);
  }
  lines.push("");

  const bySub = new Map<string, RedditRssItem[]>();
  for (const item of snapshot.items) {
    const list = bySub.get(item.sub) ?? [];
    list.push(item);
    bySub.set(item.sub, list);
  }

  for (const def of REDDIT_FEED_DEFS) {
    const posts = bySub.get(def.sub) ?? [];
    lines.push(`## r/${def.sub} (${posts.length})`);
    if (!posts.length) {
      lines.push("(no posts in window)");
      lines.push("");
      continue;
    }
    posts.forEach((p, idx) => {
      lines.push(`### ${idx + 1}. ${p.title}`);
      lines.push(`- published: ${p.published.toISOString()}`);
      lines.push(`- link: ${p.link}`);
      if (p.snippet) lines.push(`- snippet: ${p.snippet}`);
      lines.push("");
    });
  }

  return lines.join("\n").trimEnd();
}

export function redditDigestNoteName(date: Date = new Date()): string {
  return `reddit-digest-${date.toISOString().slice(0, 10)}`;
}
