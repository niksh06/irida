/**
 * Open Knowledge Format (OKF) v0.1 helpers for csagent memory notes.
 * @see https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
 */

export const OKF_VERSION = "0.1";

/** csagent wing → OKF concept type (SPEC §4.1). */
export const OKF_TYPE_BY_WING: Readonly<Record<string, string>> = {
  "cursor-lesson": "Playbook",
  "cursor-ide": "Archive",
  default: "Reference",
  meta: "Profile",
  episodic: "Episodic",
};

export interface OkfFrontmatter {
  type: string;
  title?: string;
  description?: string;
  resource?: string;
  tags?: string[];
  timestamp?: string;
  okf_version?: string;
  /** csagent extensions (not in OKF spec; preserved on round-trip). */
  wing?: string;
  status?: string;
  source?: string;
  sourceHash?: string;
}

export interface OkfDocument {
  frontmatter: OkfFrontmatter;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/;

/** Map wing namespace to OKF type string. */
export function okfTypeForWing(wing: string): string {
  return OKF_TYPE_BY_WING[wing] ?? "Reference";
}

/** memory:// note URI for OKF resource field. */
export function okfMemoryResource(name: string): string {
  return `memory://${name}`;
}

function parseYamlScalar(raw: string): string {
  const t = raw.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function parseYamlListBlock(lines: string[], start: number): { value: string[]; next: number } {
  const out: string[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!/^\s*-\s+/.test(line)) break;
    out.push(parseYamlScalar(line.replace(/^\s*-\s+/, "")));
    i++;
  }
  return { value: out, next: i };
}

/** Minimal YAML subset for OKF frontmatter (flat keys, scalar or inline/list). */
export function parseSimpleYaml(text: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const m = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1]!;
    const rest = m[2] ?? "";
    if (rest === "") {
      const list = parseYamlListBlock(lines, i + 1);
      if (list.value.length) {
        out[key] = list.value;
        i = list.next;
        continue;
      }
      out[key] = "";
      i++;
      continue;
    }
    if (rest.startsWith("[") && rest.endsWith("]")) {
      const inner = rest.slice(1, -1).trim();
      out[key] = inner
        ? inner.split(",").map((s) => parseYamlScalar(s))
        : [];
    } else {
      out[key] = parseYamlScalar(rest);
    }
    i++;
  }
  return out;
}

export function parseOkfDocument(raw: string): OkfDocument | null {
  const m = raw.trimStart().match(FRONTMATTER_RE);
  if (!m) return null;
  const parsed = parseSimpleYaml(m[1]!);
  const type = String(parsed.type ?? "").trim();
  if (!type) return null;
  const tags = parsed.tags;
  return {
    frontmatter: {
      type,
      title: typeof parsed.title === "string" ? parsed.title : undefined,
      description: typeof parsed.description === "string" ? parsed.description : undefined,
      resource: typeof parsed.resource === "string" ? parsed.resource : undefined,
      tags: Array.isArray(tags) ? tags : undefined,
      timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : undefined,
      okf_version:
        typeof parsed.okf_version === "string" ? parsed.okf_version : undefined,
      wing: typeof parsed.wing === "string" ? parsed.wing : undefined,
      status: typeof parsed.status === "string" ? parsed.status : undefined,
      source: typeof parsed.source === "string" ? parsed.source : undefined,
      sourceHash: typeof parsed.sourceHash === "string" ? parsed.sourceHash : undefined,
    },
    body: (m[2] ?? "").trimStart(),
  };
}

function yamlQuote(s: string): string {
  const text = String(s);
  if (/[:#\[\]{}&*!|>'"%@`]/.test(text) || text.includes("\n")) {
    return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return text;
}

export function serializeOkfFrontmatter(fm: OkfFrontmatter): string {
  const lines: string[] = ["---"];
  lines.push(`type: ${yamlQuote(fm.type)}`);
  if (fm.title) lines.push(`title: ${yamlQuote(fm.title)}`);
  if (fm.description) lines.push(`description: ${yamlQuote(fm.description)}`);
  if (fm.resource) lines.push(`resource: ${yamlQuote(fm.resource)}`);
  if (fm.tags?.length) {
    lines.push(`tags: [${fm.tags.map(yamlQuote).join(", ")}]`);
  }
  if (fm.timestamp) lines.push(`timestamp: ${yamlQuote(fm.timestamp)}`);
  if (fm.okf_version) lines.push(`okf_version: ${yamlQuote(fm.okf_version)}`);
  if (fm.wing) lines.push(`wing: ${yamlQuote(fm.wing)}`);
  if (fm.status) lines.push(`status: ${yamlQuote(fm.status)}`);
  if (fm.source) lines.push(`source: ${yamlQuote(fm.source)}`);
  if (fm.sourceHash) lines.push(`sourceHash: ${yamlQuote(fm.sourceHash)}`);
  lines.push("---");
  return lines.join("\n");
}

export function serializeOkfDocument(fm: OkfFrontmatter, body: string): string {
  const trimmed = body.trim();
  return trimmed
    ? `${serializeOkfFrontmatter(fm)}\n\n${trimmed}\n`
    : `${serializeOkfFrontmatter(fm)}\n`;
}

/** Prefer OKF frontmatter title, then first markdown H1, then note name. */
export function titleFromOkfOrBody(name: string, body: string): string {
  const doc = parseOkfDocument(body);
  if (doc?.frontmatter.title?.trim()) return doc.frontmatter.title.trim();
  const h1 = body.match(/^#\s+(.+)$/m);
  return h1?.[1]?.trim() || name;
}

/** Read cursor-lesson lineage from OKF frontmatter or legacy HTML comment. */
export function parseLessonLineage(body: string | undefined): {
  source?: string;
  sourceHash?: string;
  status?: string;
} {
  if (!body) return {};
  const doc = parseOkfDocument(body);
  if (doc?.frontmatter.source) {
    const { source, sourceHash, status } = doc.frontmatter;
    return { source, sourceHash, status };
  }
  const m = body.match(
    /<!-- csagent cursor-lesson; source=([^;\s]+)(?:;\s*sourceHash=([a-f0-9]+))?(?:;\s*status=([^;\s]+))?/
  );
  if (!m) return {};
  return { source: m[1], sourceHash: m[2], status: m[3] };
}

function firstSummaryBullet(body: string): string | undefined {
  const section = body.match(/## Summary\s*\n([\s\S]*?)(?=\n## |\n---|$)/)?.[1];
  if (!section) return undefined;
  const bullet = section.split("\n").find((l) => l.trim().startsWith("-"));
  return bullet?.replace(/^\s*-\s+/, "").trim();
}

function stripLegacyLessonHeader(body: string): string {
  let out = body.trim();
  out = out.replace(/^<!-- csagent cursor-lesson[^>]* -->\s*/i, "");
  out = out.replace(/^#\s+lesson\.[^\n]+\n+/i, "");
  out = out.replace(/^Wing: cursor-lesson[^\n]*\n+/i, "");
  return out.trim();
}

const LEGACY_LESSON_HTML_AT_START_RE = /^<!-- csagent cursor-lesson[^>]* -->\s*\n?/i;

/** True when OKF frontmatter exists but body still has legacy HTML lineage comment at the top. */
export function hasLegacyLessonHtmlMeta(body: string): boolean {
  const doc = parseOkfDocument(body);
  if (!doc?.frontmatter.source) return false;
  return LEGACY_LESSON_HTML_AT_START_RE.test(doc.body.trim());
}

/** Remove legacy HTML lineage comment from OKF lesson body (frontmatter is source of truth). */
export function stripLegacyLessonHtmlMeta(body: string): string {
  const doc = parseOkfDocument(body);
  if (!doc?.frontmatter.source) return body;
  const stripped = stripLegacyLessonHeader(doc.body);
  if (stripped === doc.body.trim()) return body;
  return serializeOkfDocument(doc.frontmatter, stripped);
}

/** Patch OKF frontmatter status (e.g. proposal → approved). */
export function patchLessonStatus(body: string, status: string): string {
  const doc = parseOkfDocument(body);
  if (!doc) return body;
  return serializeOkfDocument({ ...doc.frontmatter, status }, doc.body);
}

function inferLessonTags(body: string, name: string): string[] {
  const tags = new Set<string>(["csagent", "cursor-lesson"]);
  const lower = body.toLowerCase();
  if (lower.includes("tparser")) tags.add("tparser");
  if (lower.includes("gateway")) tags.add("gateway");
  if (lower.includes("cron")) tags.add("cron");
  if (lower.includes("meta-сессия") || lower.includes("meta session")) tags.add("meta-distill");
  if (lower.includes("mcp")) tags.add("mcp");
  if (/^lesson\.(test|dry|abc|chat|save|small|new|old|chat-id)$/.test(name)) {
    tags.add("fixture");
  }
  return [...tags];
}

export interface LessonOkfMigrateInput {
  name: string;
  wing: string;
  body: string;
  updatedAt?: string;
}

/** Convert legacy HTML-comment lesson (or bare body) to OKF Playbook document. */
export function migrateLessonBodyToOkf(input: LessonOkfMigrateInput): string {
  const existing = parseOkfDocument(input.body);
  if (existing?.frontmatter.type === "Playbook" && existing.frontmatter.source) {
    return stripLegacyLessonHtmlMeta(input.body);
  }

  const legacy = parseLessonLineage(input.body);
  const stripped = stripLegacyLessonHeader(input.body);
  const title = titleFromOkfOrBody(input.name, stripped);
  const description = firstSummaryBullet(stripped) ?? title;

  const fm: OkfFrontmatter = {
    type: "Playbook",
    title,
    description: description.slice(0, 240),
    resource: okfMemoryResource(input.name),
    tags: inferLessonTags(stripped, input.name),
    timestamp: input.updatedAt ? String(input.updatedAt) : undefined,
    okf_version: OKF_VERSION,
    wing: input.wing,
    status: legacy.status ?? "proposal",
    source: legacy.source,
    sourceHash: legacy.sourceHash,
  };

  return serializeOkfDocument(fm, stripped);
}

export type OkfIssueSeverity = "error" | "warn";

export interface OkfConformanceIssue {
  code: string;
  message: string;
  severity: OkfIssueSeverity;
}

function okfIssue(
  code: string,
  message: string,
  severity: OkfIssueSeverity = "error"
): OkfConformanceIssue {
  return { code, message, severity };
}

/** OKF v0.1 conformance check (SPEC §4.1 + Google enrichment_agent bundle validator). */
export function validateOkfConformance(
  body: string,
  wing: string
): OkfConformanceIssue[] {
  const issues: OkfConformanceIssue[] = [];
  const doc = parseOkfDocument(body);
  if (!doc) {
    issues.push(okfIssue("missing_frontmatter", "No OKF YAML frontmatter block"));
    return issues;
  }
  if (!doc.frontmatter.type.trim()) {
    issues.push(okfIssue("missing_type", "Frontmatter type is required"));
  }
  const expected = okfTypeForWing(wing);
  if (doc.frontmatter.type !== expected && wing !== "default") {
    issues.push(
      okfIssue(
        "type_wing_mismatch",
        `type=${doc.frontmatter.type} expected ${expected} for wing ${wing}`
      )
    );
  }
  if (!doc.frontmatter.title?.trim()) {
    issues.push(
      okfIssue("missing_title", "Recommended: title for index/search previews", "warn")
    );
  }
  if (!doc.frontmatter.description?.trim()) {
    issues.push(
      okfIssue("missing_description", "Recommended: description one-liner", "warn")
    );
  }
  if (!doc.frontmatter.timestamp?.trim()) {
    issues.push(
      okfIssue("missing_timestamp", "Recommended: ISO 8601 timestamp for freshness", "warn")
    );
  }
  return issues;
}

export function isOkfDocument(body: string): boolean {
  return parseOkfDocument(body) !== null;
}
