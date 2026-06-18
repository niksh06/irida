import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = resolve(import.meta.dirname, "..", "src");

function importsOf(file: string): string[] {
  const text = readFileSync(resolve(SRC, file), "utf8");
  const re = /from\s+"\.\/([A-Za-z0-9_]+)\.js"/g;
  const mods: string[] = [];
  for (const m of text.matchAll(re)) mods.push(m[1]!);
  return mods;
}

// Arch-2: the gateway config/allowlist/pairing cluster must be a DAG.
// Leaf modules import nothing from the higher gateway layers.
test("gateway config/pairing leaves do not import the top modules", () => {
  const TOP = ["gatewayConfig", "gatewayPairing", "gatewayAllowlist"];
  for (const leaf of ["gatewayConfigTypes", "gatewayPairingStore", "gatewayAllowedPg"]) {
    const offenders = importsOf(`${leaf}.ts`).filter((m) => TOP.includes(m));
    assert.deepEqual(offenders, [], `${leaf}.ts must not import ${offenders.join(", ")}`);
  }
});

test("gatewayAllowlist does not import the gatewayConfig/gatewayPairing top modules", () => {
  const offenders = importsOf("gatewayAllowlist.ts").filter((m) =>
    ["gatewayConfig", "gatewayPairing"].includes(m)
  );
  assert.deepEqual(offenders, [], `gatewayAllowlist imports ${offenders.join(", ")}`);
});

test("gatewayConfig does not import gatewayPairing (top) — would reintroduce the cycle", () => {
  assert.ok(!importsOf("gatewayConfig.ts").includes("gatewayPairing"));
});
