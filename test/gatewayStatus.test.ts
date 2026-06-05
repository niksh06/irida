import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
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
