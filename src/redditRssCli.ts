/**
 * CLI entry for deploy/scripts/reddit-rss-fetch.sh (I-77).
 */
import { fetchAllRedditFeeds, formatRedditFeedSnapshot } from "./redditRss.js";

async function main(): Promise<void> {
  const windowHours = Number(process.env.REDDIT_RSS_WINDOW_HOURS ?? "24");
  if (!Number.isFinite(windowHours) || windowHours <= 0) {
    console.error("reddit-rss-fetch: REDDIT_RSS_WINDOW_HOURS must be a positive number");
    process.exit(2);
  }
  const snapshot = await fetchAllRedditFeeds(windowHours);
  console.log(formatRedditFeedSnapshot(snapshot));
}

main().catch((e) => {
  console.error(`reddit-rss-fetch: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
