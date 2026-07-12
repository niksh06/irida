import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { vesperStatus, vesperTell } from "../src/gatewayVesper.js";

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "vesper-gw-"));
  mkdirSync(resolve(root, "state"), { recursive: true });
  writeFileSync(resolve(root, "state", "name.json"), JSON.stringify({ name: "Vesper" }));
  writeFileSync(
    resolve(root, "state", "journal.jsonl"),
    JSON.stringify({ ts: "2026-07-12T10:00:00Z", kind: "wake", mode: "normal", decision: "ACT", reason: "изучал tokenManager", sleepMinutes: 600 }) + "\n"
  );
  writeFileSync(
    resolve(root, "state", "next-wake.json"),
    JSON.stringify({ at: new Date(Date.now() + 90 * 60_000).toISOString(), mode: "normal", reason: "x" })
  );
  writeFileSync(
    resolve(root, "state", "proposals.jsonl"),
    JSON.stringify({ ts: "t", title: "a", detail: "", status: "pending" }) + "\n" +
      JSON.stringify({ ts: "t", title: "b", detail: "", status: "applied" }) + "\n"
  );
  return root;
}

describe("gateway /vesper (I-158)", () => {
  it("bare command renders a compact status", () => {
    const s = vesperStatus(makeRoot());
    assert.ok(s.includes("Vesper"));
    assert.ok(s.includes("ACT"));
    assert.ok(s.includes("Предложений ждёт решения: 1"));
    assert.ok(s.includes("/vesper <текст>"));
  });

  it("text goes to the inbox in the ouroboros jsonl shape", () => {
    const root = makeRoot();
    const reply = vesperTell("Держи курс, отличная работа", root, new Date("2026-07-12T12:00:00Z"));
    assert.ok(reply.startsWith("✉ Весперу"));
    const line = readFileSync(resolve(root, "state", "inbox.jsonl"), "utf8").trim();
    const msg = JSON.parse(line);
    assert.equal(msg.text, "Держи курс, отличная работа");
    assert.equal(msg.ts, "2026-07-12T12:00:00.000Z");
    assert.equal(msg.delivered_at, undefined);
  });

  it("missing repo fails soft with the path in the reply", () => {
    const s = vesperStatus("/nonexistent/ouroboros");
    assert.ok(s.includes("репо не найдено"));
  });
});
