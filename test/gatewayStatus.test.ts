import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatherGatewayStatus } from "../src/gatewayStatus.js";
import { writeExampleGatewayConfig } from "../src/gateway_cmd.js";
import { enqueueOutbox } from "../src/gatewayOutbox.js";

test("gatherGatewayStatus reports gateway config when present", () => {
  const dir = mkdtempSync(join(tmpdir(), "gwstat-"));
  writeExampleGatewayConfig(dir);
  const rows = gatherGatewayStatus(dir);
  const cfg = rows.find((r) => r.name === "gateway config");
  assert.ok(cfg);
  assert.equal(cfg!.ok, true);
});

test("gatherGatewayStatus reads gateway.log for operational health", () => {
  const dir = mkdtempSync(join(tmpdir(), "gwstat-err-"));
  const home = join(dir, "home");
  const logs = join(home, "logs");
  mkdirSync(logs, { recursive: true });
  writeFileSync(join(logs, "gateway.error.log"), "");
  writeFileSync(
    join(logs, "gateway.log"),
    "[gateway] telegram long-poll started (interval=1500ms)\n[chat] sendTurn ok status=finished\n"
  );
  const prev = process.env.CSAGENT_HOME;
  process.env.CSAGENT_HOME = home;
  writeExampleGatewayConfig(dir);
  const health = gatherGatewayStatus(dir).find((r) => r.name === "gateway health");
  assert.ok(health);
  assert.equal(health!.ok, true);
  assert.match(health!.detail, /stdout/);
  assert.match(health!.detail, /long-poll started|sendTurn ok/);
  if (prev === undefined) delete process.env.CSAGENT_HOME;
  else process.env.CSAGENT_HOME = prev;
});

test("gatherGatewayStatus reports outbox pending count", () => {
  const dir = mkdtempSync(join(tmpdir(), "gwstat-outbox-"));
  writeExampleGatewayConfig(dir);
  enqueueOutbox(dir, { chatId: "99", text: "pending reply" });
  const row = gatherGatewayStatus(dir).find((r) => r.name === "outbox");
  assert.ok(row);
  assert.equal(row!.ok, true);
  assert.match(row!.detail, /1 pending/);
});
