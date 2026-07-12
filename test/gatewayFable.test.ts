import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fableStatus, fableTell } from "../src/gatewayFable.js";

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "fable-gw-"));
  mkdirSync(resolve(root, "state"), { recursive: true });
  return root;
}

describe("gateway /fable (I-160)", () => {
  it("bare command renders status; empty inbox says so", () => {
    const s = fableStatus(makeRoot());
    assert.ok(s.includes("Fable"));
    assert.ok(s.includes("Лоток пуст"));
    assert.ok(s.includes("/fable <текст>"));
  });

  it("text is appended to state/fable-inbox.jsonl and shows up in status", () => {
    const root = makeRoot();
    const reply = fableTell("посмотри воркспейс Веспера", root, new Date("2026-07-13T08:00:00Z"));
    assert.ok(reply.startsWith("✉ Fable"));
    const line = readFileSync(resolve(root, "state", "fable-inbox.jsonl"), "utf8").trim();
    const msg = JSON.parse(line);
    assert.equal(msg.text, "посмотри воркспейс Веспера");
    assert.equal(msg.ts, "2026-07-13T08:00:00.000Z");
    const s = fableStatus(root);
    assert.ok(s.includes("Сообщений в лотке: 1"));
  });

  it("missing repo fails soft with the path in the reply", () => {
    const s = fableStatus("/nonexistent/ouroboros");
    assert.ok(s.includes("не найдено"));
  });
});
