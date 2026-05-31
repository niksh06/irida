#!/usr/bin/env node
/**
 * csagent bin launcher: run compiled dist/cli.js and rebuild when src/ is newer.
 * Avoids stale global `csagent` after git pull without manual npm run build.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distCli = join(root, "dist/cli.js");

function walkTs(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walkTs(p, out);
    else if (/\.tsx?$/.test(ent.name)) out.push(p);
  }
  return out;
}

function newestMtime(paths) {
  let max = 0;
  for (const p of paths) {
    if (!existsSync(p)) continue;
    max = Math.max(max, statSync(p).mtimeMs);
  }
  return max;
}

function distIsStale() {
  if (!existsSync(distCli)) return true;
  const distM = statSync(distCli).mtimeMs;
  const srcM = newestMtime(walkTs(join(root, "src")));
  return srcM > distM;
}

function rebuild() {
  const r = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
    cwd: root,
    stdio: "inherit",
  });
  return r.status === 0 && existsSync(distCli);
}

function runViaTsx(args) {
  const tsxCli = join(root, "node_modules", ".bin", "tsx");
  const srcCli = join(root, "src", "cli.ts");
  if (!existsSync(tsxCli) || !existsSync(srcCli)) return false;
  const run = spawnSync(process.execPath, [tsxCli, srcCli, ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  process.exit(run.status ?? 1);
}

if (distIsStale()) {
  process.stderr.write("csagent: dist is stale — running npm run build…\n");
  if (!rebuild()) {
    process.stderr.write("csagent: build failed — falling back to tsx (dev mode)\n");
    runViaTsx(process.argv.slice(2));
    process.stderr.write("csagent: tsx fallback unavailable; try npm install && npm run build\n");
    process.exit(78);
  }
}

const run = spawnSync(process.execPath, [distCli, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: "inherit",
});
process.exit(run.status ?? 1);
