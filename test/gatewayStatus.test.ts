import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatherGatewayStatus } from "../src/gatewayStatus.js";
import { writeExampleGatewayConfig } from "../src/gateway_cmd.js";

test("gatherGatewayStatus reports gateway config when present", () => {
  const dir = mkdtempSync(join(tmpdir(), "gwstat-"));
  writeExampleGatewayConfig(dir);
  const rows = gatherGatewayStatus(dir);
  const cfg = rows.find((r) => r.name === "gateway config");
  assert.ok(cfg);
  assert.equal(cfg!.ok, true);
});

test("gatherGatewayStatus reads gateway.error.log not empty stdout", () => {
  const dir = mkdtempSync(join(tmpdir(), "gwstat-err-"));
  const home = join(dir, "home");
  const logs = join(home, "logs");
  mkdirSync(logs, { recursive: true });
  writeFileSync(join(logs, "gateway.log"), "");
  writeFileSync(
    join(logs, "gateway.error.log"),
    "[gateway] telegram long-poll started (interval=1500ms)\n"
  );
  const prev = process.env.CSAGENT_HOME;
  process.env.CSAGENT_HOME = home;
  writeExampleGatewayConfig(dir);
  const logRow = gatherGatewayStatus(dir).find((r) => r.name === "gateway log");
  assert.ok(logRow);
  assert.match(logRow!.detail, /stderr/);
  assert.match(logRow!.detail, /long-poll started/);
  if (prev === undefined) delete process.env.CSAGENT_HOME;
  else process.env.CSAGENT_HOME = prev;
});
