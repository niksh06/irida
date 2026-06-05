/**
 * Telegram follow-up commands after TParser digest (I-11).
 * Maps short user phrases to focused agent prompts.
 */

export interface DigestFollowup {
  label: string;
  prompt: string;
}

const SPHERE_ALIASES: Record<string, string> = {
  infosec: "InfoSec",
  "info sec": "InfoSec",
  security: "security",
  ai: "AI",
  ml: "ML",
  llm: "LLM",
  mlsec: "MLSec",
  devsecops: "DevSecOps",
  programming: "programming",
  devtools: "devtools",
};

function normalizeInput(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[«»"']/g, "")
    .replace(/\s+/g, " ");
}

function spherePrompt(sphere: string): DigestFollowup {
  return {
    label: `filter:${sphere}`,
    prompt: `[digest-followup] TParser expanded digest (last 2 hours). Filter **only** sphere/tag: ${sphere}. Use the same API flow as bi-hourly digest (recent-live, by-keys, memory_get tparser-workflow). Show up to 50 posts ranked by priority with tg_link per post. Russian Telegram body. Do not re-add seen_post facts already recorded today unless new posts appeared.`,
  };
}

function topNPrompt(n: number): DigestFollowup {
  return {
    label: `top-${n}`,
    prompt: `[digest-followup] TParser expanded digest (last 2 hours). Show **top-${n}** posts by priority (not 15). Same APIs as bi-hourly digest. Include tg_link for each. Russian Telegram body, compact list format.`,
  };
}

/** Parse digest follow-up; null = normal free-form message. */
export function parseDigestFollowup(text: string): DigestFollowup | null {
  const t = normalizeInput(text);
  if (!t) return null;

  const top = t.match(/^(?:топ[- ]?|top[- ]?)(\d{1,2})$/);
  if (top) {
    const n = Math.min(Math.max(parseInt(top[1]!, 10), 1), 50);
    return topNPrompt(n);
  }

  const onlyRu = t.match(/^только\s+(.+)$/);
  const onlyEn = t.match(/^only\s+(.+)$/);
  const sphereRaw = (onlyRu?.[1] ?? onlyEn?.[1] ?? "").trim();
  if (sphereRaw) {
    const key = sphereRaw.replace(/\s+/g, " ");
    const sphere = SPHERE_ALIASES[key] ?? SPHERE_ALIASES[key.replace(/\s/g, "")];
    if (sphere) return spherePrompt(sphere);
    return spherePrompt(sphereRaw);
  }

  return null;
}
