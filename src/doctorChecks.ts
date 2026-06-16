/**
 * Doctor checks as data (shared by CLI and TUI).
 */
import { accessSync, constants, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { CONFIG_FILE, ConfigError, loadConfig, resolveMemoryRoot, validateMcpServers } from "./config.js";
import { browserMcpEnabled, resolveMcpServers } from "./mcpServers.js";
import { resolveBrowserRoot } from "./mcp/browserContext.js";
import {
  apiKeySourceLabel,
  hasPlaintextCredentialsOnDisk,
  pgSecretsEnabled,
  resolveApiKey,
  resolveTelegramBotToken,
  telegramTokenSourceLabel,
  validateCursorApiKeyFormat,
  validateTelegramBotTokenFormat,
} from "./credentials.js";
import { probePgCredentialStore, SECRETS_KEY_ENV, secretsKey } from "./credentialsPg.js";
import { probePostgresStore } from "./store.js";
import {
  findLatestCronJobsBackup,
  loadCronJobs,
  validateCronJobsFile,
  cronJobsPath,
} from "./cronJobs.js";
import { gatherCronPromptDrift } from "./cronPromptDrift.js";
import { gatherCronContextDirIssue } from "./cronContextArtifact.js";
import { loadGatewayConfig, validateGatewayConfig, gatewayConfigPath } from "./gatewayConfig.js";
import { gatherMemorySilos, siloIsAligned } from "./memorySiloOps.js";
import { gatherCronPromptGuardIssues } from "./cronPromptGuard.js";
import { listSkills, loadSkill, scanSkillThreat, skillExists } from "./skills.js";
import { loadRunMetrics } from "./runMetrics.js";
import { gatherStaleDistChecks } from "./doctorDistStale.js";
import { createMemoryStore } from "./memoryStore.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  /** Copy-paste remediation shown under a failed check (A4). */
  fix?: string;
}

export function gatherDoctorChecks(dir: string = process.cwd()): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  const resolved = resolveApiKey(dir);
  checks.push({
    name: "CURSOR_API_KEY",
    ok: resolved.key.length > 0,
    detail: apiKeySourceLabel(resolved.source, dir),
    fix: 'printf %s "cursor_..." | csagent auth login --stdin',
  });

  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "node >= 20", ok: major >= 20, detail: `v${process.versions.node}` });
  checks.push({ name: "cwd", ok: true, detail: dir });
  const home = process.env.CSAGENT_HOME?.trim();
  if (home) {
    checks.push({ name: "CSAGENT_HOME", ok: true, detail: home });
  }

  let cfgOk = true;
  let cfgDetail = `defaults (no ${CONFIG_FILE})`;
  let mcpErrs: string[] = [];
  let mcpCount = 0;
  try {
    const c = loadConfig(dir);
    if (existsSync(resolve(dir, CONFIG_FILE))) {
      cfgDetail = `loaded (model=${c.model}, runtime=${c.runtime})`;
    }
    const merged = resolveMcpServers(c, dir);
    mcpCount = Object.keys(merged).length;
    mcpErrs = validateMcpServers(merged);
  } catch (e) {
    cfgOk = false;
    cfgDetail = e instanceof ConfigError ? e.message : String(e);
  }
  checks.push({ name: "config", ok: cfgOk, detail: cfgDetail });
  if (cfgOk) {
    checks.push({
      name: "mcp config",
      ok: mcpErrs.length === 0,
      detail: mcpErrs.length ? mcpErrs.join("; ") : `${mcpCount} server(s), parse ok`,
    });
  }

  let writeOk = true;
  let writeDetail = "state dir writable (created on first run)";
  let stateRoot = resolveMemoryRoot(dir);
  const probeTarget = existsSync(stateRoot) ? stateRoot : dir;
  try {
    accessSync(probeTarget, constants.W_OK);
    if (existsSync(stateRoot)) writeDetail = `${stateRoot} writable`;
  } catch {
    writeOk = false;
    writeDetail = `${probeTarget} not writable`;
  }
  checks.push({ name: "state writable", ok: writeOk, detail: writeDetail });

  const ctxIssue = gatherCronContextDirIssue(dir);
  if (ctxIssue) {
    checks.push({ name: "cron context dir", ok: false, detail: ctxIssue });
  }

  checks.push(...gatherMemoryEnvChecks(dir));
  checks.push(...gatherBrowserEnvChecks(dir));
  checks.push(...gatherGatewaySkillsChecks(dir));
  checks.push(...gatherCredentialsEnvChecks(dir));
  checks.push(...gatherDoctorSecretFormatChecks(dir));
  checks.push(...gatherRunLogChecks(dir));
  checks.push(...gatherStaleDistChecks(dir));

  const cronPath = cronJobsPath(dir);
  if (existsSync(cronPath)) {
    const cronErrs = validateCronJobsFile(dir);
    const bak = cronErrs.length ? findLatestCronJobsBackup(dir) : null;
    const fixBase = "compare with deploy/cron.jobs.example.json, then: csagent cron list";
    checks.push({
      name: "cron jobs",
      ok: cronErrs.length === 0,
      detail: cronErrs.length ? cronErrs.join("; ") : "cron.jobs.json valid",
      fix: bak ? `${fixBase}; restore: cp "${bak}" "${cronPath}"` : fixBase,
    });
    if (cronErrs.length === 0) {
      const drift = gatherCronPromptDrift(dir);
      checks.push({
        name: "cron prompts",
        ok: drift.ok,
        detail: drift.ok ? "deploy/runtime prompts aligned" : drift.warnings.join("; "),
      });
      const guard = gatherCronPromptGuardIssues(dir);
      checks.push({
        name: "cron prompt guard",
        ok: guard.length === 0,
        detail: guard.length ? guard.join("; ") : "no injection patterns",
      });
    }
  }

  const gwPath = gatewayConfigPath(dir);
  if (existsSync(gwPath)) {
    const gwErrs = validateGatewayConfig(dir);
    checks.push({
      name: "gateway",
      ok: gwErrs.length === 0,
      detail: gwErrs.length ? gwErrs.join("; ") : "gateway.json valid",
      fix: "cp deploy/gateway.json.example .agent/gateway.json  # then set allowedChatIds + token: csagent auth telegram login --stdin",
    });
  }

  return checks;
}

function gatherRunLogChecks(dir: string): DoctorCheck[] {
  let stateDir = ".agent";
  try {
    stateDir = loadConfig(dir).stateDir;
  } catch {
    return [];
  }
  const metrics = loadRunMetrics(dir, stateDir, 24);
  if (metrics.runs === 0) {
    return [{ name: "run log tokens", ok: true, detail: "no runs in last 24h" }];
  }
  const hasTokens = metrics.inputTokens > 0 || metrics.outputTokens > 0;
  return [
    {
      name: "run log tokens",
      ok: hasTokens,
      detail: hasTokens
        ? `tokens in/out ${metrics.inputTokens}/${metrics.outputTokens} (${metrics.runs} runs 24h)`
        : `${metrics.runs} run(s) in 24h with null token fields — SDK usage may not be captured (I-33)`,
    },
  ];
}

function gatherDoctorSecretFormatChecks(dir: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const api = resolveApiKey(dir);
  if (api.key) {
    const fmt = validateCursorApiKeyFormat(api.key);
    checks.push({
      name: "CURSOR_API_KEY format",
      ok: fmt.ok,
      detail: fmt.ok
        ? `ok (${api.key.length} chars, ${apiKeySourceLabel(api.source, dir)})`
        : `${fmt.detail} — ${apiKeySourceLabel(api.source, dir)}`,
    });
  }
  const tg = resolveTelegramBotToken(dir);
  if (tg.value) {
    const fmt = validateTelegramBotTokenFormat(tg.value);
    checks.push({
      name: "TELEGRAM_BOT_TOKEN format",
      ok: fmt.ok,
      detail: fmt.ok
        ? `ok (${tg.value.length} chars, ${telegramTokenSourceLabel(tg.source, dir)})`
        : `${fmt.detail} — ${telegramTokenSourceLabel(tg.source, dir)}`,
    });
  }
  return checks;
}

function gatherCredentialsEnvChecks(dir: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const pg = process.env.CSAGENT_DATABASE_URL?.trim();
  const key = secretsKey();
  if (pg && !key) {
    checks.push({
      name: "credentials store",
      ok: true,
      detail: `plaintext ${loadConfig(dir).stateDir}/credentials.json (set ${SECRETS_KEY_ENV} for pgcrypto)`,
    });
    return checks;
  }
  if (pg && key) {
    const plain = hasPlaintextCredentialsOnDisk(dir);
    checks.push({
      name: "credentials plaintext",
      ok: !plain,
      detail: plain
        ? "credentials.json still has plaintext — run auth login to migrate"
        : "no plaintext secrets on disk",
      fix: 'printf %s "cursor_..." | csagent auth login --stdin  # re-save migrates to pgcrypto',
    });
  }
  return checks;
}

function gatherBrowserEnvChecks(dir: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  let cfg;
  try {
    cfg = loadConfig(dir);
  } catch {
    return checks;
  }
  if (!browserMcpEnabled(cfg)) return checks;

  const browserRoot = resolveBrowserRoot(dir);
  let writable = true;
  try {
    accessSync(existsSync(browserRoot) ? browserRoot : resolveMemoryRoot(dir), constants.W_OK);
  } catch {
    writable = false;
  }
  checks.push({
    name: "browser profile",
    ok: writable,
    detail: writable
      ? `${browserRoot} (profile=${cfg.browser?.profile || "default"})`
      : `${browserRoot} not writable`,
  });
  return checks;
}

function gatherMemoryEnvChecks(dir: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const pg = process.env.CSAGENT_DATABASE_URL?.trim();
  const home = process.env.CSAGENT_HOME?.trim();
  const canonical = resolveMemoryRoot(dir);

  checks.push({
    name: "memory root",
    ok: true,
    detail: `${canonical}/memory`,
  });

  if (pg && !home) {
    checks.push({
      name: "memory env",
      ok: false,
      detail: "CSAGENT_DATABASE_URL set without CSAGENT_HOME — dev may read a different silo than gateway",
    });
  }

  const { canonical: memoryDir, silos } = gatherMemorySilos(dir);
  for (const silo of silos) {
    const aligned = siloIsAligned(silo.path, memoryDir);
    checks.push({
      name: silo.label === "repo" ? "memory silo" : `memory silo (${silo.label})`,
      ok: aligned,
      detail: aligned
        ? `${silo.path} aligned with ${memoryDir}`
        : `${silo.count} note(s) in ${silo.path} — run: csagent memory align-silo`,
      fix: "csagent memory align-silo",
    });
  }

  try {
    const cfg = loadConfig(dir);
    const ar = cfg.memory?.autoRag;
    if (ar?.enabled) {
      const wings = ar.wings ?? [];
      const hasMeta = wings.includes("meta");
      checks.push({
        name: "autoRag",
        ok: !hasMeta,
        detail: hasMeta
          ? "wings includes meta — use preTurn for profiles, not autoRag"
          : `enabled · limit=${ar.limit ?? 3} · wings=${wings.length ? wings.join(",") : "all"}`,
        fix: hasMeta ? 'remove "meta" from memory.autoRag.wings or set enabled: false' : undefined,
      });
    } else {
      checks.push({
        name: "autoRag",
        ok: true,
        detail: "disabled (MCP-first); pilot: deploy/PERSONAL-OPS.md#autorag-pilot",
      });
    }
  } catch {
    /* config check reported separately */
  }

  return checks;
}

function gatherGatewaySkillsChecks(dir: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const gwPath = gatewayConfigPath(dir);
  if (!existsSync(gwPath)) return checks;
  try {
    const gw = loadGatewayConfig(dir);
    const cfg = loadConfig(dir);
    const missing = gw.skills.filter((s) => !skillExists(dir, cfg.skillsPath, s));
    if (gw.skills.length === 0) return checks;
    checks.push({
      name: "gateway skills",
      ok: missing.length === 0,
      detail:
        missing.length === 0
          ? `${gw.skills.join(", ")} present in skills/`
          : `missing: ${missing.join(", ")} (run deploy/setup-home.sh)`,
    });
    const allowUnsafe = cfg.skillPolicy?.allowUnsafe ?? [];
    const threatFails: string[] = [];
    for (const name of gw.skills) {
      try {
        const skill = loadSkill(dir, cfg.skillsPath, name, { allowUnsafe });
        const hits = scanSkillThreat(skill, allowUnsafe);
        if (hits.length) threatFails.push(name);
      } catch (e) {
        threatFails.push(`${name} (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    if (gw.skills.length) {
      checks.push({
        name: "skills threat scan",
        ok: threatFails.length === 0,
        detail:
          threatFails.length === 0
            ? `${gw.skills.length} skill(s) ok`
            : `FAIL: ${threatFails.join(", ")}`,
      });
    }
  } catch {
    /* gateway parse errors surfaced elsewhere */
  }
  const root = process.env.CSAGENT_ROOT?.trim();
  if (root && root !== dir) {
    try {
      const gw = loadGatewayConfig(dir);
      const missingRoot = gw.skills.filter(
        (s) => !skillExists(root, loadConfig(root).skillsPath, s)
      );
      if (missingRoot.length) {
        checks.push({
          name: "CSAGENT_ROOT skills",
          ok: false,
          detail: `${root}/skills missing: ${missingRoot.join(", ")}`,
        });
      }
    } catch {
      /* optional */
    }
  }
  return checks;
}

export function doctorAllOk(checks: DoctorCheck[]): boolean {
  return checks.every((c) => c.ok);
}

export type ModelsListFn = (opts: { apiKey: string }) => Promise<Array<{ id?: string }>>;

export async function gatherDoctorStoreChecks(dir: string = process.cwd()): Promise<DoctorCheck[]> {
  const url = process.env.CSAGENT_DATABASE_URL?.trim();
  const checks: DoctorCheck[] = [];
  if (!url) {
    checks.push({ name: "store", ok: true, detail: "sqlite (CSAGENT_DATABASE_URL unset)" });
  } else {
    const probe = await probePostgresStore(url);
    checks.push({ name: "CSAGENT_DATABASE_URL", ok: probe.ok, detail: probe.detail });
    if (pgSecretsEnabled()) {
      const cred = await probePgCredentialStore(url, secretsKey());
      checks.push({ name: "credential_secrets", ok: cred.ok, detail: cred.detail });
    }
  }

  const store = createMemoryStore(dir);
  try {
    const malformed = await store.countMalformedSubjectFacts();
    checks.push({
      name: "fact hygiene",
      ok: malformed === 0,
      detail:
        malformed === 0
          ? "no malformed --* fact fields"
          : `${malformed} fact(s) with subject/predicate starting with "--"`,
      fix: "csagent memory fact purge-malformed-subjects",
    });
  } catch (e) {
    checks.push({
      name: "fact hygiene",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  } finally {
    await store.close();
  }

  return checks;
}

/** Tier-1 Cursor API probe (models list). Skipped when key is unset. */
export async function gatherDoctorApiChecks(
  dir: string = process.cwd(),
  deps?: { listModels?: ModelsListFn }
): Promise<DoctorCheck[]> {
  void dir;
  const resolved = resolveApiKey(dir);
  const key = resolved.key;
  if (!key) return [];

  const listModels =
    deps?.listModels ??
    (async (opts: { apiKey: string }) => {
      const { Cursor } = await import("@cursor/sdk");
      return Cursor.models.list(opts);
    });

  try {
    const list = await listModels({ apiKey: key });
    const count = list.filter((m) => typeof m.id === "string" && m.id.trim()).length;
    if (count === 0) {
      return [{ name: "Cursor API (models)", ok: false, detail: "empty model list" }];
    }
    return [{ name: "Cursor API (models)", ok: true, detail: `${count} model(s) visible` }];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const lower = msg.toLowerCase();
    const detail =
      lower.includes("fetch") || lower.includes("network") || lower.includes("econnrefused")
        ? `network error — ${msg}`
        : msg.includes("Authentication") || lower.includes("unauthenticated") || lower.includes("not logged in")
          ? `authentication failed — refresh CURSOR_API_KEY in Cursor Integrations`
          : msg;
    return [{ name: "Cursor API (models)", ok: false, detail }];
  }
}
