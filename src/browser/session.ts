/**
 * Cookie persistence for named browser profiles.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "puppeteer";

export function profilesRoot(browserRoot: string): string {
  return join(browserRoot, "profiles");
}

export function profileCookiesPath(browserRoot: string, profile: string): string {
  return join(profilesRoot(browserRoot), profile, "cookies.json");
}

export function ensureBrowserDirs(browserRoot: string, profile: string): void {
  mkdirSync(join(browserRoot, profile), { recursive: true });
  mkdirSync(join(profilesRoot(browserRoot), profile), { recursive: true });
}

export async function saveCookies(
  page: Page,
  browserRoot: string,
  profile: string
): Promise<string> {
  const cookies = await page.cookies();
  const path = profileCookiesPath(browserRoot, profile);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(cookies, null, 2), "utf8");
  return path;
}

export async function loadCookies(
  page: Page,
  browserRoot: string,
  profile: string
): Promise<boolean> {
  const path = profileCookiesPath(browserRoot, profile);
  if (!existsSync(path)) return false;
  const cookies = JSON.parse(readFileSync(path, "utf8")) as Awaited<ReturnType<Page["cookies"]>>;
  if (!Array.isArray(cookies) || cookies.length === 0) return false;
  await page.setCookie(...cookies);
  return true;
}
