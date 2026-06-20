/**
 * Singleton stealth Chromium (puppeteer-extra + stealth plugin).
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page } from "puppeteer";

const puppeteer = puppeteerExtra as unknown as {
  use(plugin: unknown): void;
  launch: (typeof import("puppeteer"))["launch"];
};
import {
  DEFAULT_NAVIGATION_TIMEOUT_MS,
  DEFAULT_PROTOCOL_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
  DEFAULT_VIEWPORT_HEIGHT,
  DEFAULT_VIEWPORT_WIDTH,
} from "./defaults.js";
import { ensureBrowserDirs, loadCookies, saveCookies } from "./session.js";
import { iridaBrowserNoSandbox, iridaBrowserInsecureTls, iridaChromePath } from "../env.js";

puppeteer.use(StealthPlugin());

export interface BrowserLaunchOptions {
  browserRoot: string;
  profile: string;
  headless: boolean;
  userAgent: string;
  chromePath?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  text: string;
  elements: Array<{
    ref: number;
    tag: string;
    role: string;
    name: string;
    value: string;
  }>;
}

let browser: Browser | null = null;
let page: Page | null = null;
let activeProfile = "default";

function launchArgs(viewportW: number, viewportH: number): string[] {
  const args = [
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    `--window-size=${viewportW},${viewportH}`,
    "--start-maximized",
    "--disable-infobars",
    "--disable-extensions",
    "--no-first-run",
    "--no-default-browser-check",
  ];
  // Disabling the Chromium sandbox and TLS verification is dangerous when
  // visiting arbitrary (agent-steerable) web content. Keep both OFF by default;
  // only opt in via env for constrained environments (e.g. root in a container).
  if (iridaBrowserNoSandbox() === "1") {
    args.push("--no-sandbox", "--disable-setuid-sandbox");
  }
  if (iridaBrowserInsecureTls() === "1") {
    args.push("--ignore-certificate-errors");
  }
  return args;
}

async function applyStealthPatches(target: Page): Promise<void> {
  await target.setUserAgent(DEFAULT_USER_AGENT);
  await target.setViewport({
    width: DEFAULT_VIEWPORT_WIDTH,
    height: DEFAULT_VIEWPORT_HEIGHT,
    deviceScaleFactor: 1,
  });
  await target.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
  });
  await target.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "platform", { get: () => "Win32" });
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
    Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
    Object.defineProperty(navigator, "plugins", {
      get: () => [
        {
          0: {
            type: "application/x-google-chrome-pdf",
            suffixes: "pdf",
            description: "Portable Document Format",
          },
          description: "Portable Document Format",
          filename: "internal-pdf-viewer",
          length: 1,
          name: "Chrome PDF Plugin",
        },
      ],
    });
    Object.defineProperty(navigator, "connection", {
      get: () => ({ effectiveType: "4g", rtt: 50, downlink: 10, saveData: false }),
    });
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{
        charging: boolean;
        chargingTime: number;
        dischargingTime: number;
        level: number;
      }>;
    };
    if (!nav.getBattery) {
      nav.getBattery = () =>
        Promise.resolve({
          charging: true,
          chargingTime: 0,
          dischargingTime: Infinity,
          level: 1,
        });
    }
  });
}

export async function ensureBrowser(opts: BrowserLaunchOptions): Promise<Page> {
  const userDataDir = join(opts.browserRoot, opts.profile);
  ensureBrowserDirs(opts.browserRoot, opts.profile);
  if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true });

  if (browser && page && activeProfile === opts.profile) {
    return page;
  }

  if (browser) {
    await browser.close().catch(() => undefined);
    browser = null;
    page = null;
  }

  const launched = await puppeteer.launch({
    headless: opts.headless,
    protocolTimeout: DEFAULT_PROTOCOL_TIMEOUT_MS,
    executablePath: opts.chromePath?.trim() || iridaChromePath() || undefined,
    userDataDir,
    args: launchArgs(DEFAULT_VIEWPORT_WIDTH, DEFAULT_VIEWPORT_HEIGHT),
    defaultViewport: {
      width: DEFAULT_VIEWPORT_WIDTH,
      height: DEFAULT_VIEWPORT_HEIGHT,
    },
  });
  browser = launched;

  const pages = await launched.pages();
  page = pages.length > 0 ? pages[0]! : await launched.newPage();
  await applyStealthPatches(page);
  await page.setUserAgent(opts.userAgent || DEFAULT_USER_AGENT);
  activeProfile = opts.profile;
  return page;
}

export async function navigate(
  target: Page,
  url: string,
  waitUntil: "load" | "domcontentloaded" | "networkidle0" | "networkidle2" = "domcontentloaded"
): Promise<void> {
  target.setDefaultNavigationTimeout(DEFAULT_NAVIGATION_TIMEOUT_MS);
  await target.goto(url, { waitUntil, timeout: DEFAULT_NAVIGATION_TIMEOUT_MS });
}

export async function captureSnapshot(target: Page): Promise<PageSnapshot> {
  const data = await target.evaluate(() => {
    const selectors =
      'a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"]';
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(selectors));
    const elements = nodes.slice(0, 80).map((el, idx) => {
      const ref = idx + 1;
      el.setAttribute("data-csagent-ref", String(ref));
      const role = el.getAttribute("role") || el.tagName.toLowerCase();
      const name =
        el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        el.getAttribute("name") ||
        (el as HTMLInputElement).labels?.[0]?.textContent?.trim() ||
        el.textContent?.trim().slice(0, 120) ||
        "";
      const value =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
          ? el.value
          : el.getAttribute("href") || "";
      return { ref, tag: el.tagName.toLowerCase(), role, name, value };
    });
    const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 4000);
    return {
      url: location.href,
      title: document.title,
      text,
      elements,
    };
  });
  return data;
}

export async function clickRef(target: Page, ref: number): Promise<void> {
  const selector = `[data-csagent-ref="${ref}"]`;
  await target.waitForSelector(selector, { timeout: 10_000 });
  await target.click(selector);
}

export async function typeRef(
  target: Page,
  ref: number,
  text: string,
  clear: boolean
): Promise<void> {
  const selector = `[data-csagent-ref="${ref}"]`;
  await target.waitForSelector(selector, { timeout: 10_000 });
  if (clear) {
    await target.click(selector, { clickCount: 3 });
    await target.keyboard.press("Backspace");
  }
  await target.type(selector, text, { delay: 25 });
}

export async function pressKey(target: Page, key: string): Promise<void> {
  await target.keyboard.press(key as Parameters<Page["keyboard"]["press"]>[0]);
}

export async function saveSession(
  target: Page,
  browserRoot: string,
  profile: string
): Promise<string> {
  return saveCookies(target, browserRoot, profile);
}

export async function loadSession(
  target: Page,
  browserRoot: string,
  profile: string
): Promise<boolean> {
  return loadCookies(target, browserRoot, profile);
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => undefined);
  }
  browser = null;
  page = null;
  activeProfile = "default";
}
