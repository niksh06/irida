/**
 * TParser daily digest — five topic buckets for delegate sub-runs.
 */
export interface TparserTopic {
  id: string;
  title: string;
  /** Tag/sphere hints for filtering (see memory note tparser-workflow). */
  tagHints: string[];
}

export const TPARSE_DAILY_TOPICS: TparserTopic[] = [
  {
    id: "ai-ml",
    title: "AI / ML / LLM",
    tagHints: ["AI", "ML", "LLM", "benchmark", "research", "agent", "RAG", "fine-tuning"],
  },
  {
    id: "aisec-mlsec",
    title: "AISec / MLSec",
    tagHints: ["AISec", "MLSec", "LLM security", "adversarial", "jailbreak", "prompt injection", "model abuse"],
  },
  {
    id: "infosec",
    title: "InfoSec / AppSec",
    tagHints: ["InfoSec", "AppSec", "security", "vulnerability", "CVE", "exploit", "malware", "incident"],
  },
  {
    id: "programming",
    title: "Programming / devtools",
    tagHints: ["programming", "devtools", "language", "framework", "open source", "library", "IDE"],
  },
  {
    id: "devsecops-devops",
    title: "DevSecOps / DevOps",
    tagHints: ["DevSecOps", "DevOps", "CI/CD", "K8s", "kubernetes", "cloud", "infra", "SRE", "terraform"],
  },
];

export function topicTagHintLine(topic: TparserTopic): string {
  return topic.tagHints.join(", ");
}
