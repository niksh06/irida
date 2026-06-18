/**
 * Cookie persistence for named browser profiles.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "puppeteer";

export function profilesRoot(browserRoot: string): string {
  return join(browserRoot, "profiles");
}

/**
 * Profile names become path segments; reject anything that could traverse out
 * of the profiles dir (`..`, separators, absolute paths). The agent can choose
 * the profile name, so an unsanitized value is a path-traversal primitive.
 */
export function assertSafeProfileName(profile: string): string {
  const name = profile.trim();
  if (!name || !/^[A-Za-z0-9._-]+$/.test(name) || name === "." || name === "..") {
    throw new Error(`invalid profile name: ${JSON.stringify(profile)} (allowed: letters, digits, . _ -)`);
  }
  return name;
}

export function profileCookiesPath(browserRoot: string, profile: string): string {
  return join(profilesRoot(browserRoot), assertSafeProfileName(profile), "cookies.json");
}

export function ensureBrowserDirs(browserRoot: string, profile: string): void {
  const name = assertSafeProfileName(profile);
  mkdirSync(join(browserRoot, name), { recursive: true });
  mkdirSync(join(profilesRoot(browserRoot), name), { recursive: true });
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
  let cookies: unknown;
  try {
    cookies = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
  if (!Array.isArray(cookies) || cookies.length === 0) return false;
  // Only inject well-formed cookie objects — a malformed/crafted file must not
  // become a cross-origin cookie-injection vector via setCookie.
  const valid = cookies.filter(
    (c): c is { name: string; value: string } =>
      c != null &&
      typeof c === "object" &&
      typeof (c as { name?: unknown }).name === "string" &&
      typeof (c as { value?: unknown }).value === "string"
  );
  if (valid.length === 0) return false;
  await page.setCookie(...(valid as Awaited<ReturnType<Page["cookies"]>>));
  return true;
}
