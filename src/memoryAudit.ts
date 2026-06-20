/**
 * Automated memory audit (notes, facts, silos, optional link checks).
 */
import { existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, resolveMemoryRoot } from "./config.js";
import { listMemories, memoryDir } from "./memory.js";
import { CURSOR_TRANSCRIPT_WING } from "./memoryWings.js";
import { createMemoryStore, type MemoryNote } from "./memoryStore.js";
import { gatherMemorySilos, siloIsAligned } from "./memorySiloOps.js";
import { EXIT } from "./exit.js";
import type { CronExecuteResult } from "./cronRunRecord.js";

export const DEFAULT_STALE_DAYS = 90;
export const SEEN_POST_WARN_THRESHOLD = 3000; // legacy rows only; digest no longer writes seen_post
export const MAX_LINK_CHECKS = 40;
export const MEMORY_AUDIT_RESULT_FILE = "memory-audit.last.json";

/** Personal ops notes — link/stale checks focus here when --ops-only. */
export const OPS_NOTE_NAMES = new Set([
  "tparser-workflow",
  "telegram-atlas-discovery",
  "dbugs",
  "csagent-index",
]);

const URL_RE = /https?:\/\/[^\s)\]>"']+|(?:^|[\s(])t\.me\/[^\s)\]>"']+/gi;

export interface MemoryAuditCheck {
  name: string;
  ok: boolean;
  severity: "fail" | "warn" | "ok";
  detail: string;
}

export interface MemoryAuditReport {
  at: string;
  ok: boolean;
  checks: MemoryAuditCheck[];
}

export interface MemoryAuditOptions {
  dir?: string;
  staleDays?: number;
  checkLinks?: boolean;
  opsOnly?: boolean;
  linkTimeoutMs?: number;
}

function check(
  name: string,
  ok: boolean,
  detail: string,
  severity: "fail" | "warn" | "ok" = ok ? "ok" : "fail"
): MemoryAuditCheck {
  return { name, ok, severity, detail };
}

function warn(name: string, ok: boolean, detail: string): MemoryAuditCheck {
  return { name, ok, severity: ok ? "ok" : "warn", detail };
}

export function isOpsNote(note: MemoryNote): boolean {
  return OPS_NOTE_NAMES.has(note.name) || note.wing === "default";
}

export function extractUrls(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    let u = m[0].trim();
    if (u.startsWith("t.me/")) u = `https://${u}`;
    u = u.replace(/[.,;:!?)]+$/, "");
    if (u.length > 8) found.add(u);
  }
  return [...found];
}

function daysSince(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 86_400_000;
}

function isStubNote(note: MemoryNote): boolean {
  const body = note.body.replace(/^#.+$/m, "").trim();
  return body.length < 80;
}

export async function checkUrlReachable(
  url: string,
  timeoutMs = 8000
): Promise<{ ok: boolean; status?: number; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "irida-memory-audit/1.0" },
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": "irida-memory-audit/1.0" },
      });
    }
    if (res.status >= 400) {
      return { ok: false, status: res.status, detail: `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status, detail: `HTTP ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: msg.slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

export function memoryAuditResultPath(dir: string): string {
  const cfg = loadConfig(dir);
  return resolve(dir, cfg.stateDir, MEMORY_AUDIT_RESULT_FILE);
}

export function saveMemoryAuditResult(dir: string, report: MemoryAuditReport): void {
  const path = memoryAuditResultPath(dir);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
}

export function formatMemoryAuditReport(report: MemoryAuditReport): string {
  const lines = [`memory audit · ${report.ok ? "PASS" : "FAIL"}`, ""];
  for (const c of report.checks) {
    const tag = c.severity === "ok" || c.ok ? "OK" : c.severity === "warn" ? "WARN" : "FAIL";
    lines.push(`${tag} ${c.name}: ${c.detail}`);
  }
  return lines.join("\n");
}

export async function evaluateMemoryAudit(opts: MemoryAuditOptions = {}): Promise<MemoryAuditReport> {
  const dir = opts.dir ?? process.cwd();
  const staleDays = opts.staleDays ?? DEFAULT_STALE_DAYS;
  const checks: MemoryAuditCheck[] = [];
  const store = createMemoryStore(dir, loadConfig(dir).stateDir);

  try {
    const notes = await store.listNotes();
    const factStats = await store.factAuditSummary();
    const canonical = resolve(resolveMemoryRoot(dir), "memory");
    const mdNames = new Set(listMemories(dir).map((m) => m.name));
    const dbNames = new Set(notes.map((n) => n.name));

    checks.push(
      check(
        "notes count",
        notes.length > 0,
        `${notes.length} note(s) in store · ${mdNames.size} .md on disk`
      )
    );

    const orphanMd = [...mdNames].filter((n) => !dbNames.has(n));
    const dbOnly = [...dbNames].filter((n) => !mdNames.has(n));
    checks.push(
      warn(
        "md/db sync",
        orphanMd.length === 0 && dbOnly.length === 0,
        orphanMd.length || dbOnly.length
          ? `orphan .md=${orphanMd.length}${orphanMd.length ? ` (${orphanMd.slice(0, 5).join(", ")}${orphanMd.length > 5 ? "…" : ""})` : ""}` +
              ` · db-only=${dbOnly.length}`
          : "filesystem mirror aligned with store"
      )
    );

    const opsNotes = notes.filter(isOpsNote);
    const archiveWings = new Set<string>([CURSOR_TRANSCRIPT_WING, "secure"]);
    const curatedNotes = notes.filter((n) => !archiveWings.has(n.wing));
    const staleOps = opsNotes.filter((n) => daysSince(n.updated_at) > staleDays);
    const staleCurated = curatedNotes.filter((n) => daysSince(n.updated_at) > staleDays);
    checks.push(
      warn(
        "stale ops notes",
        staleOps.length === 0,
        staleOps.length
          ? `${staleOps.length} ops note(s) older than ${staleDays}d: ${staleOps.map((n) => n.name).join(", ")}`
          : `all ${opsNotes.length} ops note(s) touched within ${staleDays}d`
      )
    );
    checks.push(
      check(
        "stale curated notes",
        true,
        `${staleCurated.length}/${curatedNotes.length} curated note(s) older than ${staleDays}d (informational; excludes cursor-ide archive)`
      )
    );

    const stubs = opsNotes.filter(isStubNote);
    checks.push(
      warn(
        "ops stubs",
        stubs.length === 0,
        stubs.length
          ? `short/empty ops notes: ${stubs.map((n) => n.name).join(", ")}`
          : "no stub ops notes"
      )
    );

    const seen = factStats.subjects.find((s) => s.subject === "seen_post");
    checks.push(
      check(
        "facts total",
        true,
        `${factStats.currentTotal} current · ${factStats.invalidatedTotal} invalidated`
      )
    );
    if (seen && seen.current > 0) {
      checks.push(
        warn(
          "seen_post legacy",
          false,
          `${seen.current} legacy seen_post fact(s) — digest no longer writes these; run: irida memory fact purge-seen-post`
        )
      );
    } else {
      checks.push(check("seen_post legacy", true, "no current seen_post facts"));
    }

    const malformed = factStats.subjects
      .filter((s) => s.subject.startsWith("--"))
      .reduce((n, s) => n + s.current, 0);
    checks.push(
      warn(
        "malformed fact subjects",
        malformed === 0,
        malformed === 0
          ? "no current facts with subject starting with --"
          : `${malformed} fact(s) with subject starting with -- — run: irida memory fact purge-malformed-subjects`
      )
    );

    const topSubjects = factStats.subjects
      .slice(0, 6)
      .map((s) => `${s.subject}=${s.current}`)
      .join(", ");
    checks.push(check("facts by subject", true, topSubjects || "none"));

    const { silos } = gatherMemorySilos(dir);
    const misaligned = silos.filter((s) => !siloIsAligned(s.path, canonical));
    checks.push(
      check(
        "memory silos",
        misaligned.length === 0,
        misaligned.length
          ? `misaligned: ${misaligned.map((s) => s.label).join(", ")} — run: irida memory align-silo`
          : silos.length
            ? `${silos.length} silo(s) aligned with ${canonical}`
            : "no extra silos"
      )
    );

    const linkNotes = (opts.opsOnly !== false ? opsNotes : notes).slice(0, 20);
    const urlEntries: Array<{ note: string; url: string }> = [];
    for (const note of linkNotes) {
      for (const url of extractUrls(note.body)) {
        urlEntries.push({ note: note.name, url });
        if (urlEntries.length >= MAX_LINK_CHECKS) break;
      }
      if (urlEntries.length >= MAX_LINK_CHECKS) break;
    }

    if (!opts.checkLinks) {
      checks.push(
        check(
          "links",
          true,
          `${urlEntries.length} URL(s) in scope (use --links to probe, max ${MAX_LINK_CHECKS})`
        )
      );
    } else {
      const broken: string[] = [];
      for (const { note, url } of urlEntries) {
        const r = await checkUrlReachable(url, opts.linkTimeoutMs ?? 8000);
        if (!r.ok) broken.push(`${note}: ${url} (${r.detail})`);
      }
      checks.push(
        check(
          "links",
          broken.length === 0,
          broken.length
            ? `${broken.length} broken of ${urlEntries.length} checked · ${broken.slice(0, 3).join("; ")}${broken.length > 3 ? "…" : ""}`
            : `${urlEntries.length} URL(s) reachable`
        )
      );
    }
  } finally {
    await store.close();
  }

  const ok = checks.every((c) => c.ok || c.severity === "warn");
  return { at: new Date().toISOString(), ok, checks };
}

/** Deterministic cron handler — audit notes/facts (no seen_post writes). */
export async function executeMemoryAuditBuiltin(dir: string): Promise<CronExecuteResult> {
  const report = await evaluateMemoryAudit({ dir, staleDays: DEFAULT_STALE_DAYS, opsOnly: true });
  saveMemoryAuditResult(dir, report);
  const body = formatMemoryAuditReport(report);
  return {
    ok: report.ok,
    exitCode: report.ok ? EXIT.ok : EXIT.software,
    message: body.slice(0, 400),
    output: body,
  };
}
