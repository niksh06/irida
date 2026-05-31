import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_CHANNEL,
  isGatewaySession,
  sessionAllowedForChannel,
  sessionChannelConflictMessage,
} from "../src/sessionChannel.js";
import type { SessionRecord } from "../src/store.js";

function row(partial: Partial<SessionRecord> & Pick<SessionRecord, "id">): SessionRecord {
  return {
    id: partial.id,
    title: partial.title ?? "",
    cwd: partial.cwd ?? "/",
    runtime: "local",
    sdk_agent_id: null,
    created_at: "",
    updated_at: "",
    last_status: "",
    selected_skills: "",
    mcp_server_names: "",
    channel: partial.channel ?? "",
  };
}

test("TUI cannot open telegram or gateway-peer sessions", () => {
  const peerIds = new Set(["sess_tg"]);
  assert.equal(
    sessionAllowedForChannel(row({ id: "sess_tg", channel: SESSION_CHANNEL.telegram }), SESSION_CHANNEL.tui, peerIds),
    false
  );
  assert.equal(
    sessionAllowedForChannel(row({ id: "sess_tg", channel: "" }), SESSION_CHANNEL.tui, peerIds),
    false
  );
  assert.equal(
    sessionAllowedForChannel(row({ id: "sess_ui", channel: SESSION_CHANNEL.tui }), SESSION_CHANNEL.tui, peerIds),
    true
  );
  assert.match(sessionChannelConflictMessage(row({ id: "x", channel: SESSION_CHANNEL.telegram })), /gateway/);
});

test("isGatewaySession detects channel and peer map", () => {
  assert.equal(isGatewaySession(row({ id: "a", channel: SESSION_CHANNEL.webhook })), true);
  assert.equal(isGatewaySession(row({ id: "b", channel: "" }), new Set(["b"])), true);
  assert.equal(isGatewaySession(row({ id: "c", channel: SESSION_CHANNEL.tui })), false);
});
