import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { openChatSession, type ChatSession } from "../chatEngine.js";
import { banner, theme } from "./theme.js";
import { Composer } from "./components/Composer.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { MessageList } from "./components/MessageList.js";
import { StatusBar } from "./components/StatusBar.js";
import type { ChatMessage, ConfirmState, SessionMeta } from "./types.js";

let msgSeq = 0;
function nextId(prefix: string): string {
  return `${prefix}-${++msgSeq}`;
}

export interface TuiOptions {
  dir?: string;
  skills?: string[];
  yesIUnderstand?: boolean;
}

export function App(props: TuiOptions) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;

  const sessionRef = useRef<ChatSession | null>(null);
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    { id: nextId("sys"), role: "system", text: "Connecting to Cursor SDK…" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [exiting, setExiting] = useState(false);

  const confirmRef = useRef<(reason: string) => Promise<boolean>>(async () => false);
  confirmRef.current = (reason) =>
    new Promise((resolve) => {
      setConfirm({ reason, resolve });
    });

  const pushMessage = useCallback((msg: Omit<ChatMessage, "id">) => {
    setMessages((prev) => [...prev, { ...msg, id: nextId(msg.role) }]);
  }, []);

  const patchStreaming = useCallback((delta: string) => {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === "assistant" && last.streaming) {
        next[next.length - 1] = { ...last, text: last.text + delta };
      }
      return next;
    });
  }, []);

  const finishStreaming = useCallback(() => {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.streaming) {
        next[next.length - 1] = { ...last, streaming: false };
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const opened = await openChatSession({
        dir: props.dir,
        skills: props.skills,
        yesIUnderstand: props.yesIUnderstand,
        interactive: true,
        confirm: (reason) => confirmRef.current(reason),
        onAssistantDelta: (d) => {
          if (!cancelled) patchStreaming(d);
        },
        onLog: () => {},
      });

      if (cancelled) {
        if (opened.ok) await opened.session.close();
        return;
      }

      if (!opened.ok) {
        setFatal(opened.message);
        setMessages([{ id: nextId("err"), role: "error", text: opened.message }]);
        return;
      }

      sessionRef.current = opened.session;
      setMeta({
        sessionId: opened.session.sessionId,
        agentId: opened.session.agentId,
        cwd: opened.session.cfg.cwd,
        model: opened.session.cfg.model,
      });
      setMessages([
        {
          id: nextId("sys"),
          role: "system",
          text: `Session ${opened.session.sessionId.slice(0, 8)}… · ${opened.session.cfg.model}`,
        },
      ]);
    })();

    return () => {
      cancelled = true;
      void sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, [patchStreaming, props.dir, props.skills, props.yesIUnderstand]);

  const shutdown = useCallback(async () => {
    if (exiting) return;
    setExiting(true);
    await sessionRef.current?.close();
    sessionRef.current = null;
    exit();
  }, [exit, exiting]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") void shutdown();
  });

  const handleSubmit = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy || exiting || fatal || confirm) return;

    setInput("");
    if (text === "/exit" || text === "exit" || text === "quit" || text === ":q") {
      pushMessage({ role: "system", text: "Goodbye." });
      await shutdown();
      return;
    }

    const session = sessionRef.current;
    if (!session) return;

    pushMessage({ role: "user", text });
    pushMessage({ role: "assistant", text: "", streaming: true });
    setBusy(true);

    const out = await session.sendTurn(text);
    finishStreaming();
    setBusy(false);

    if (out.kind === "blocked") {
      setMessages((prev) => {
        const next = prev.slice(0, -1);
        return [...next, { id: nextId("err"), role: "error", text: `Blocked: ${out.reason}` }];
      });
      return;
    }
    if (out.kind === "error") {
      setMessages((prev) => {
        const next = prev.slice(0, -1);
        return [...next, { id: nextId("err"), role: "error", text: out.message }];
      });
      if (out.fatal) setFatal(out.message);
    }
  };

  const composerDisabled = Boolean(busy || fatal || confirm || exiting || !meta);

  return (
    <Box flexDirection="column" width="100%">
      <Box flexDirection="column" marginBottom={0}>
        <Text color={theme.primary}>{banner.trimEnd()}</Text>
      </Box>

      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="round"
        borderColor={theme.border}
        paddingY={0}
        minHeight={8}
      >
        <MessageList messages={messages} width={cols} />
        {confirm ? (
          <ConfirmDialog state={confirm} onDone={() => setConfirm(null)} />
        ) : null}
      </Box>

      <Composer
        value={input}
        onChange={setInput}
        onSubmit={(v) => void handleSubmit(v)}
        disabled={composerDisabled}
        placeholder={fatal ? "session failed" : busy ? "agent is thinking…" : undefined}
      />

      <StatusBar meta={meta} busy={busy} error={fatal} />
    </Box>
  );
}
