/**
 * Telegram follow-up commands after TParser digest (I-11, H2 depth).
 * Maps short user phrases to focused agent prompts.
 */
import { TPARSE_DAILY_TOPICS } from "./tparserTopics.js";

export interface DigestFollowup {
  label: string;
  prompt: string;
}

const SPHERE_ALIASES: Record<string, string> = {
  infosec: "InfoSec",
  "info sec": "InfoSec",
  "info security": "InfoSec",
  appsec: "AppSec",
  security: "security",
  ai: "AI",
  "ai/ml": "AI",
  ml: "ML",
  llm: "LLM",
  aisec: "AISec",
  mlsec: "MLSec",
  "llm security": "LLM security",
  devsecops: "DevSecOps",
  devops: "DevOps",
  programming: "programming",
  devtools: "devtools",
  "программирование": "programming",
};

/** Register topic ids and titles as follow-up sphere keys. */
function registerTopicAliases(): void {
  for (const topic of TPARSE_DAILY_TOPICS) {
    SPHERE_ALIASES[topic.id] = topic.title;
    SPHERE_ALIASES[topic.id.replace(/-/g, " ")] = topic.title;
    const short = topic.title.split("/")[0]?.trim().toLowerCase();
    if (short) SPHERE_ALIASES[short] = topic.title;
  }
}
registerTopicAliases();

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
    prompt: `[digest-followup] TParser expanded digest (last 24 hours). Filter **only** sphere/tag: ${sphere}. Use the same API flow as daily digest (recent-live, by-keys, memory_get tparser-workflow). Per post: structure + agent verdict + tg_link. Show up to 50 posts ranked by priority. Russian Telegram body. Do not write memory_fact_add / seen_post facts.`,
  };
}

function topNPrompt(n: number): DigestFollowup {
  return {
    label: `top-${n}`,
    prompt: `[digest-followup] TParser expanded digest (last 24 hours). Show **top-${n}** posts by priority. Same APIs as daily digest. Per post: structure + verdict + tg_link. Russian Telegram body.`,
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
    const sphere =
      SPHERE_ALIASES[key] ??
      SPHERE_ALIASES[key.replace(/\s/g, "")] ??
      SPHERE_ALIASES[key.replace(/\s/g, "-")];
    if (sphere) return spherePrompt(sphere);
    return spherePrompt(sphereRaw);
  }

  return null;
}

/** Prefix follow-up prompt with last digest snippet when available. */
export function buildDigestFollowupTurn(basePrompt: string, digestContext: string): string {
  if (!digestContext.trim()) return basePrompt;
  return `${digestContext}${basePrompt}`;
}
