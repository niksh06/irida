/**
 * csagent-browser MCP runtime context (env + config-derived paths).
 */
import { resolve } from "node:path";
import { loadConfig, resolveMemoryRoot } from "../config.js";
import {
  csagentMemoryDir,
  csagentBrowserRoot,
  csagentBrowserProfile,
  csagentBrowserHeadless,
  csagentChromePath,
} from "../env.js";
import { DEFAULT_BROWSER_PROFILE, DEFAULT_USER_AGENT } from "../browser/defaults.js";

export interface BrowserMcpContext {
  browserRoot: string;
  profile: string;
  headless: boolean;
  userAgent: string;
  chromePath?: string;
}

export function resolveBrowserRoot(projectDir: string): string {
  const fromEnv = csagentBrowserRoot();
  if (fromEnv) return resolve(fromEnv);
  return resolve(resolveMemoryRoot(projectDir), "browser");
}

export function resolveBrowserMcpContext(projectDir?: string): BrowserMcpContext {
  const dir = projectDir || csagentMemoryDir() || process.cwd();
  const cfg = loadConfig(dir);
  const browserRoot = resolveBrowserRoot(dir);
  const profile =
    csagentBrowserProfile() ||
    cfg.browser?.profile?.trim() ||
    DEFAULT_BROWSER_PROFILE;

  const headlessEnv = csagentBrowserHeadless()?.toLowerCase();
  let headless = cfg.browser?.headless ?? true;
  if (headlessEnv === "true" || headlessEnv === "1") headless = true;
  if (headlessEnv === "false" || headlessEnv === "0") headless = false;

  return {
    browserRoot,
    profile,
    headless,
    userAgent: cfg.browser?.userAgent?.trim() || DEFAULT_USER_AGENT,
    chromePath: csagentChromePath() || cfg.browser?.chromePath?.trim(),
  };
}
