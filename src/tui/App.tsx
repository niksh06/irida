import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { openChatSession, type ChatSession } from "../chatEngine.js";
import { banner, theme } from "./theme.js";
import { Composer } from "./components/Composer.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { MessageList } from "./components/MessageList.js";
import { StatusBar } from "./components/StatusBar.js";
import { HelpPanel } from "./components/HelpPanel.js";
import { SessionPicker } from "./components/SessionPicker.js";
import { ActivityBar } from "./components/ActivityBar.js";
import { parseSlash } from "./slash.js";
import { estimateVisibleMessages, runsToMessages, viewportMessages } from "./transcript.js";
import { listStoredSessions, loadSessionRuns } from "./loadSessions.js";
import type { ChatMessage, ConfirmState, Overlay, SessionMeta } from "./types.js";
import type { SessionRecord } from "../store.js";

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
  const rows = stdout?.rows ?? 24;
  const dir = props.dir ?? process.cwd();

  const sessionRef = useRef<ChatSession | null>(null);
  const bootGen = useRef(0);

  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    { id: nextId("sys"), role: "system", text: "Connecting to Cursor SDK…" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [exiting, setExiting] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [activity, setActivity] = useState<string | null>(null);
  const [pickerSessions, setPickerSessions] = useState<SessionRecord[]>([]);
  const [pickerIndex, setPickerIndex] = useState(0);

  const confirmRef = useRef<(reason: string) => Promise<boolean>>(async () => false);
  confirmRef.current = (reason) =>
    new Promise((resolve) => {
      setConfirm({ reason, resolve });
    });

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

  const pushMessage = useCallback((msg: Omit<ChatMessage, "id">) => {
    setMessages((prev) => [...prev, { ...msg, id: nextId(msg.role) }]);
  }, []);

  const bootSession = useCallback(
    async (resumeSessionId?: string) => {
      const gen = ++bootGen.current;
      await sessionRef.current?.close();
      sessionRef.current = null;

      const opened = await openChatSession({
        dir,
        skills: props.skills,
        yesIUnderstand: props.yesIUnderstand,
        resumeSessionId,
        interactive: true,
        confirm: (reason) => confirmRef.current(reason),
        onAssistantDelta: (d) => patchStreaming(d),
        onActivity: (label) => setActivity(label),
        onLog: () => {},
      });

      if (gen !== bootGen.current) {
        if (opened.ok) await opened.session.close();
        return opened.ok ? null : opened;
      }

      if (!opened.ok) {
        setFatal(opened.message);
        setMessages([{ id: nextId("err"), role: "error", text: opened.message }]);
        setMeta(null);
        return opened;
      }

      sessionRef.current = opened.session;
      const s = opened.session;
      setMeta({
        sessionId: s.sessionId,
        agentId: s.agentId,
        cwd: s.cfg.cwd,
        model: s.cfg.model,
        connectMode: s.connectMode,
      });
      setFatal(null);
      setScrollOffset(0);

      const history = resumeSessionId ? runsToMessages(loadSessionRuns(dir, resumeSessionId)) : [];
      const modeNote =
        s.connectMode === "resumed"
          ? "live resume"
          : s.connectMode === "replayed"
            ? "transcript replay"
            : "new session";
      setMessages([
        {
          id: nextId("sys"),
          role: "system",
          text: `${modeNote} · ${s.sessionId.slice(0, 10)}… · ${s.cfg.model}`,
        },
        ...history,
      ]);
      return opened;
    },
    [dir, patchStreaming, props.skills, props.yesIUnderstand]
  );

  useEffect(() => {
    void bootSession();
    return () => {
      bootGen.current++;
      void sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, [bootSession]);

  const visibleCount = useMemo(() => estimateVisibleMessages(rows), [rows]);
  const viewport = useMemo(
    () => viewportMessages(messages, visibleCount, scrollOffset),
    [messages, visibleCount, scrollOffset]
  );

  const shutdown = useCallback(async () => {
    if (exiting) return;
    setExiting(true);
    await sessionRef.current?.close();
    sessionRef.current = null;
    exit();
  }, [exit, exiting]);

  const openSessionsOverlay = useCallback(() => {
    try {
      setPickerSessions(listStoredSessions(dir));
      setPickerIndex(0);
      setOverlay("sessions");
    } catch (e) {
      pushMessage({ role: "error", text: String(e) });
    }
  }, [dir, pushMessage]);

  const switchToSession = useCallback(
    async (record: SessionRecord) => {
      setOverlay(null);
      setBusy(true);
      pushMessage({ role: "system", text: `Switching to ${record.id.slice(0, 12)}…` });
      const out = await bootSession(record.id);
      setBusy(false);
      if (out && !out.ok) {
        pushMessage({ role: "error", text: out.message });
      }
    },
    [bootSession, pushMessage]
  );

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      void shutdown();
      return;
    }
    if (overlay || confirm || busy || exiting) return;

    if (key.ctrl && input === "u") {
      setScrollOffset((o) => Math.min(messages.length, o + 2));
      return;
    }
    if (key.ctrl && input === "d") {
      setScrollOffset((o) => Math.max(0, o - 2));
      return;
    }
    if (key.ctrl && input === "e") {
      setScrollOffset(0);
    }
  });

  const handleSubmit = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy || exiting || fatal || confirm || overlay) return;

    setInput("");

    const slash = parseSlash(text);
    if (slash) {
      switch (slash.type) {
        case "exit":
          pushMessage({ role: "system", text: "Goodbye." });
          await shutdown();
          return;
        case "clear":
          setMessages([{ id: nextId("sys"), role: "system", text: "Transcript cleared." }]);
          setScrollOffset(0);
          return;
        case "help":
          setOverlay("help");
          return;
        case "sessions":
          openSessionsOverlay();
          return;
        case "resume":
          setBusy(true);
          {
            const out = await bootSession(slash.sessionId);
            if (out && !out.ok) pushMessage({ role: "error", text: out.message });
          }
          setBusy(false);
          return;
        case "unknown":
          pushMessage({ role: "error", text: `Unknown command: /${slash.command}` });
          return;
      }
    }

    if (text === "exit" || text === "quit" || text === ":q") {
      pushMessage({ role: "system", text: "Goodbye." });
      await shutdown();
      return;
    }

    const session = sessionRef.current;
    if (!session) return;

    pushMessage({ role: "user", text });
    pushMessage({ role: "assistant", text: "", streaming: true });
    setScrollOffset(0);
    setBusy(true);
    setActivity("thinking…");

    const out = await session.sendTurn(text);
    finishStreaming();
    setBusy(false);
    setActivity(null);

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

  const composerDisabled = Boolean(busy || fatal || confirm || exiting || overlay || !meta);
  const scrollHint =
    scrollOffset > 0 ? `scroll +${scrollOffset}` : viewport.hiddenAbove > 0 ? "scroll" : null;

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
        <MessageList
          messages={viewport.visible}
          width={cols}
          hiddenAbove={viewport.hiddenAbove}
          hiddenBelow={viewport.hiddenBelow}
          atBottom={viewport.atBottom}
        />
        <ActivityBar label={activity} busy={busy} />
        {confirm ? (
          <ConfirmDialog state={confirm} onDone={() => setConfirm(null)} />
        ) : null}
        {overlay === "help" ? <HelpPanel onClose={() => setOverlay(null)} /> : null}
        {overlay === "sessions" ? (
          <SessionPicker
            sessions={pickerSessions}
            index={pickerIndex}
            onMove={(d) =>
              setPickerIndex((i) => {
                if (pickerSessions.length === 0) return 0;
                return (i + d + pickerSessions.length) % pickerSessions.length;
              })
            }
            onSelect={(s) => void switchToSession(s)}
            onCancel={() => setOverlay(null)}
          />
        ) : null}
      </Box>

      <Composer
        value={input}
        onChange={setInput}
        onSubmit={(v) => void handleSubmit(v)}
        disabled={composerDisabled}
        placeholder={
          fatal ? "session failed" : overlay ? "close overlay first" : busy ? "agent is thinking…" : undefined
        }
      />

      <StatusBar meta={meta} busy={busy} error={fatal} scrollHint={scrollHint} />
    </Box>
  );
}
