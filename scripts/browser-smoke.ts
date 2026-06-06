#!/usr/bin/env tsx
/**
 * Live smoke: stealth browser navigate + snapshot (no Cursor API).
 * Usage: CSAGENT_CHROME_PATH=... npx tsx scripts/browser-smoke.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  captureSnapshot,
  closeBrowser,
  ensureBrowser,
  navigate,
  saveSession,
} from "../src/browser/manager.js";

const chrome =
  process.env.CSAGENT_CHROME_PATH?.trim() ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browserRoot = mkdtempSync(resolve(tmpdir(), "csagent-browser-smoke-"));

async function main(): Promise<void> {
  console.log("browser-smoke: root", browserRoot);
  console.log("browser-smoke: chrome", chrome);

  const page = await ensureBrowser({
    browserRoot,
    profile: "smoke",
    headless: true,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    chromePath: chrome,
  });

  await navigate(page, "https://example.com", "domcontentloaded");
  const snap = await captureSnapshot(page);
  console.log("title:", snap.title);
  console.log("url:", snap.url);
  console.log("elements:", snap.elements.length);
  console.log("text excerpt:", snap.text.slice(0, 120));

  assert.match(snap.url, /example\.com/);
  assert.match(snap.title, /Example Domain/i);
  assert.ok(snap.elements.length >= 1, "expected at least one interactive element");

  const cookiesPath = await saveSession(page, browserRoot, "smoke");
  console.log("saved session:", cookiesPath);

  await closeBrowser();
  console.log("browser-smoke: OK");
}

main().catch((err) => {
  console.error("browser-smoke: FAIL", err);
  process.exit(70);
});
