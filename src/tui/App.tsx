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
import { SlashSuggest } from "./components/SlashSuggest.js";
import { DoctorPanel } from "./components/DoctorPanel.js";
import { SkillsPanel } from "./components/SkillsPanel.js";
import { ToolsPanel } from "./components/ToolsPanel.js";
import { parseSlash } from "./slash.js";
import { commonSlashPrefix, filterSlashSuggestions } from "./slashCatalog.js";
import { estimateVisibleLines, maxScrollOffset, messagesToRows, runsToMessages, viewportRows } from "./transcript.js";
import { listStoredSessions, loadSessionRuns } from "./loadSessions.js";
import { useAltScreen } from "./terminal.js";
import type { ActivityEntry, ChatMessage, ConfirmState, Overlay, SessionMeta } from "./types.js";
import type { SessionRecord } from "../store.js";

let msgSeq = 0;
function nextId(prefix: string): string {
  return `${prefix}-${++msgSeq}`;
}

let actSeq = 0;
function pushActivity(setter: React.Dispatch<React.SetStateAction<ActivityEntry[]>>, label: string) {
  setter((prev) => [
    ...prev.slice(-99),
    { id: `act-${++actSeq}`, at: new Date().toISOString(), label },
  ]);
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
  const altScreen = useAltScreen();

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
  const [scrollMode, setScrollMode] = useState(false);
  const [scrollLineOffset, setScrollLineOffset] = useState(0);
  const [activity, setActivity] = useState<string | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [pickerSessions, setPickerSessions] = useState<SessionRecord[]>([]);
  const [pickerIndex, setPickerIndex] = useState(0);

  const slashSuggestions = useMemo(() => filterSlashSuggestions(input), [input]);

  const confirmRef = useRef<(reason: string) => Promise<boolean>>(async () => false);
  confirmRef.current = (reason) =>
    new Promise((resolve) => {
      setConfirm({ reason, resolve });
    });

  const noteActivity = useCallback((label: string) => {
    setActivity(label);
    pushActivity(setActivityLog, label);
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
        onActivity: (label) => noteActivity(label),
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
      setScrollLineOffset(0);
      setScrollMode(false);
      setActivityLog([]);

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
    [dir, noteActivity, patchStreaming, props.skills, props.yesIUnderstand]
  );

  useEffect(() => {
    void bootSession();
    return () => {
      bootGen.current++;
      void sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, [bootSession]);

  const visibleLines = useMemo(() => estimateVisibleLines(rows), [rows]);
  const allRows = useMemo(() => messagesToRows(messages, cols), [messages, cols]);
  const maxScroll = useMemo(() => maxScrollOffset(allRows.length, visibleLines), [allRows.length, visibleLines]);
  const viewport = useMemo(
    () => viewportRows(allRows, visibleLines, scrollLineOffset),
    [allRows, visibleLines, scrollLineOffset]
  );
  const displayRows = altScreen ? viewport.visible : allRows;
  const displayHiddenAbove = altScreen ? viewport.hiddenAbove : 0;
  const displayHiddenBelow = altScreen ? viewport.hiddenBelow : 0;
  const displayAtBottom = altScreen ? viewport.atBottom : true;

  const scrollKeysActive =
    altScreen && !overlay && !confirm && !exiting && (scrollMode || input === "" || busy);

  const scrollUp = useCallback(
    (lines = 1) => {
      setScrollLineOffset((o) => Math.min(maxScroll, o + lines));
    },
    [maxScroll]
  );
  const scrollDown = useCallback(
    (lines = 1) => {
      setScrollLineOffset((o) => Math.max(0, o - lines));
    },
    []
  );
  const scrollToBottom = useCallback(() => {
    setScrollLineOffset(0);
  }, []);

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

  useInput(
    (inputKey, key) => {
      if (key.ctrl && inputKey === "c") {
        void shutdown();
        return;
      }
      if (key.ctrl && inputKey === "o") {
        setScrollMode((m) => !m);
        return;
      }
    },
    { isActive: !overlay && !confirm && !exiting }
  );

  useInput(
    (inputKey, key) => {
      if (overlay || confirm || exiting || scrollMode) return;

      if (key.tab && input.startsWith("/")) {
        const matches = filterSlashSuggestions(input);
        if (matches.length === 1) setInput(matches[0]!);
        else if (matches.length > 1) setInput(commonSlashPrefix(matches));
      }
    },
    { isActive: !scrollMode && !overlay && !confirm && !exiting }
  );

  useInput(
    (inputKey, key) => {
      if (!scrollKeysActive) return;

      if (key.upArrow) scrollUp(1);
      else if (key.downArrow) scrollDown(1);
      else if (key.pageUp) scrollUp(visibleLines);
      else if (key.pageDown) scrollDown(visibleLines);
      else if (key.ctrl && inputKey === "u") scrollUp(3);
      else if (key.ctrl && inputKey === "d") scrollDown(3);
      else if (key.ctrl && inputKey === "e") scrollToBottom();
      else if (scrollMode && (key.return || key.escape)) setScrollMode(false);
    },
    { isActive: scrollKeysActive }
  );

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
          setScrollLineOffset(0);
          setScrollMode(false);
          return;
        case "help":
          setOverlay("help");
          return;
        case "sessions":
          openSessionsOverlay();
          return;
        case "skills":
          setOverlay("skills");
          return;
        case "doctor":
          setOverlay("doctor");
          return;
        case "tools":
          setOverlay("tools");
          return;
        case "new":
          setBusy(true);
          {
            const out = await bootSession();
            if (out && !out.ok) pushMessage({ role: "error", text: out.message });
          }
          setBusy(false);
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
    scrollToBottom();
    setScrollMode(false);
    setBusy(true);
    noteActivity("thinking…");

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

  const composerDisabled = Boolean(
    busy || fatal || confirm || exiting || overlay || !meta || (altScreen && scrollMode)
  );
  const scrollHint = !altScreen
    ? null
    : scrollMode
      ? `scroll +${scrollLineOffset}L`
      : scrollLineOffset > 0
        ? `+${scrollLineOffset}L · Ctrl+O`
        : displayHiddenAbove > 0
          ? "Ctrl+O scroll"
          : null;

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
          rows={displayRows}
          width={cols}
          hiddenAbove={displayHiddenAbove}
          hiddenBelow={displayHiddenBelow}
          atBottom={displayAtBottom}
          scrollMode={altScreen && scrollMode}
          nativeScroll={!altScreen}
        />
        <ActivityBar label={activity} busy={busy} recent={activityLog} />
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
        {overlay === "skills" ? <SkillsPanel dir={dir} onClose={() => setOverlay(null)} /> : null}
        {overlay === "doctor" ? <DoctorPanel dir={dir} onClose={() => setOverlay(null)} /> : null}
        {overlay === "tools" ? (
          <ToolsPanel entries={activityLog} onClose={() => setOverlay(null)} />
        ) : null}
      </Box>

      <SlashSuggest input={input} suggestions={slashSuggestions} />

      <Composer
        value={input}
        onChange={setInput}
        onSubmit={(v) => void handleSubmit(v)}
        disabled={composerDisabled}
        scrollMode={altScreen && scrollMode}
        placeholder={
          fatal
            ? "session failed"
            : overlay
              ? "close overlay first"
              : busy
                ? "agent is thinking…"
                : altScreen
                  ? undefined
                  : "trackpad scroll · /help"
        }
      />

      <StatusBar meta={meta} busy={busy} error={fatal} scrollHint={scrollHint} />
    </Box>
  );
}
