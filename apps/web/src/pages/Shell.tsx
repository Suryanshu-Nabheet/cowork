import { ChatMarkdown } from "@cowork/chat-ui/web";
import type {
  Bot,
  ComputerStatus,
  ProductEvent,
  Routine,
  ThreadMessage,
  ThreadSnapshot,
} from "@cowork/contracts";
import {
  cronFromPreset,
  defaultCronPreset,
  formatCron,
  presetFromCron,
  subagentBlockFromPayload,
  toolBlockFromPayload,
} from "@cowork/core";
import { BotAvatar, Button } from "@cowork/ui-web";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ClockIcon,
  CloseIcon,
  CpuIcon,
  FileTextIcon,
  KeyIcon,
  LogOutIcon,
  MonitorIcon,
  PaperclipIcon,
  PieChartIcon,
  PlusIcon,
  PuzzleIcon,
  SearchIcon,
  SendIcon,
  SettingsIcon,
  StopIcon,
  TerminalIcon,
} from "../components/icons.js";
import { authClient } from "../lib/auth";
import { playCompletionChime, usePrefs } from "../lib/prefs.js";
import { rpc } from "../lib/rpc";
import { HostComputerPrompt } from "./HostComputerPrompt";
import { MemoryOverlay } from "./MemoryOverlay";
import { PluginsOverlay } from "./PluginsOverlay";
import { RoutineSchedule } from "./RoutineSchedule";
import { SettingsModal, type SettingsTab } from "./SettingsModal";
import { WindowChrome } from "./WindowChrome";

type Panel = "computer" | "settings" | "routine" | "create" | null;

export function ShellPage() {
  const { botId } = useParams();
  const navigate = useNavigate();
  const session = authClient.useSession();
  const [bots, setBots] = useState<Bot[]>([]);
  const [query, setQuery] = useState("");
  const [snapshot, setSnapshot] = useState<ThreadSnapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [computer, setComputer] = useState<ComputerStatus | null>(null);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("models");
  const [booting, setBooting] = useState(false);
  const [routineDraft, setRoutineDraft] = useState({
    name: "",
    prompt: "",
    schedule: defaultCronPreset(),
  });
  const [screenUrl, setScreenUrl] = useState<string | null>(null);
  const [computerOpen, setComputerOpen] = useState(false);
  const autoBooted = useRef<string | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<
    Array<{
      name: string;
      size: number;
      type: string;
      content: string;
    }>
  >([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const prefs = usePrefs();

  const active = bots.find((b) => b.id === botId) ?? bots[0];

  async function refreshBots() {
    const list = await rpc.bots.list();
    setBots(list);
    if (list.length === 0) {
      navigate("/onboarding", { replace: true });
      return;
    }
    if (!botId || !list.some((bot) => bot.id === botId)) {
      navigate(`/app/${list[0]!.id}`, { replace: true });
    }
  }

  async function refreshThread(id: string) {
    const snap = await rpc.threads.get({ botId: id });
    setSnapshot(snap);
    setComputer(snap.computer);
    const r = await rpc.routines.list({ botId: id });
    setRoutines(r);
    if (panel === "computer" || computerOpen) {
      const screen = await rpc.computer.screenUrl({ botId: id }).catch(() => ({ url: null }));
      setScreenUrl(screen.url);
    }
    return snap;
  }

  useEffect(() => {
    void refreshBots();
    const poll = window.setInterval(() => void refreshBots().catch(() => undefined), 4000);
    return () => window.clearInterval(poll);
  }, []);

  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    let fallback: number | undefined;
    void (async () => {
      const snap = await refreshThread(active.id).catch(() => null);
      if (abort.signal.aborted) return;
      try {
        const events = await rpc.threads.subscribe(
          { botId: active.id, cursor: snap?.cursor ?? -1 },
          { signal: abort.signal },
        );
        for await (const event of events) {
          if (abort.signal.aborted) break;
          applyThreadEvent(event, setSnapshot, setComputer);
          if (
            event.type === "bot.spawned" ||
            event.type === "bot.deleted" ||
            event.type === "run.completed" ||
            event.type === "run.failed" ||
            event.type === "run.cancelled"
          ) {
            void refreshBots().catch(() => undefined);
          }
          if (event.type === "run.completed") {
            playCompletionChime();
            setRunNotice(null);
          }
          if (event.type === "run.failed") {
            setRunNotice(String(event.payload.error ?? "Run failed"));
          }
          if (event.type === "run.cancelled") {
            setRunNotice("Stopped");
          }
          if (event.type === "thread.message.created") {
            const blocks = (event.payload.blocks as Array<{ kind?: string }>) ?? [];
            if (blocks.some((block) => block.kind === "child_bot")) {
              void refreshBots().catch(() => undefined);
            }
          }
          if (
            event.type === "thread.message.created" ||
            event.type === "run.completed" ||
            event.type === "run.failed" ||
            event.type === "run.cancelled" ||
            event.type === "computer.status" ||
            event.type === "computer.takeover.granted"
          ) {
            void refreshThread(active.id).catch(() => undefined);
          }
        }
      } catch {
        if (!abort.signal.aborted) {
          fallback = window.setInterval(
            () => void refreshThread(active.id).catch(() => undefined),
            2500,
          );
        }
      }
    })();
    return () => {
      abort.abort();
      if (fallback !== undefined) window.clearInterval(fallback);
    };
  }, [active?.id]);

  const filtered = useMemo(
    () => bots.filter((b) => `${b.name} ${b.preview}`.toLowerCase().includes(query.toLowerCase())),
    [bots, query],
  );

  async function handleFileSelect(files: FileList | null) {
    if (!files || files.length === 0) return;
    const newAttachments: Array<{
      name: string;
      size: number;
      type: string;
      content: string;
    }> = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      try {
        const text = await file.text();
        newAttachments.push({
          name: file.name,
          size: file.size,
          type: file.type || "text/plain",
          content: text.slice(0, 50000),
        });
      } catch (err) {
        console.error("Failed to read file", file.name, err);
      }
    }
    setAttachedFiles((prev) => [...prev, ...newAttachments]);
    setAttachMenuOpen(false);
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    }
    if (attachMenuOpen) {
      window.addEventListener("mousedown", handleClickOutside);
      return () => window.removeEventListener("mousedown", handleClickOutside);
    }
  }, [attachMenuOpen]);

  useEffect(() => {
    function handleGlobalKeys(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setSettingsModalOpen(true);
      }
    }
    window.addEventListener("keydown", handleGlobalKeys);
    return () => window.removeEventListener("keydown", handleGlobalKeys);
  }, []);

  async function send() {
    if (!active || (!draft.trim() && attachedFiles.length === 0)) return;
    let text = draft.trim();
    if (attachedFiles.length > 0) {
      const fileBlocks = attachedFiles
        .map((f) => `\`\`\`${f.name}\n${f.content}\n\`\`\``)
        .join("\n\n");
      text = text ? `${text}\n\nAttached files:\n${fileBlocks}` : `Attached files:\n${fileBlocks}`;
    }
    setDraft("");
    setAttachedFiles([]);
    setAttachMenuOpen(false);

    // Optimistic update for instant responsiveness
    const optimisticMsgId = `optimistic-${Date.now()}`;
    const userMsg: ThreadMessage = {
      id: optimisticMsgId,
      threadId: snapshot?.threadId ?? "",
      seq: (snapshot?.cursor ?? 0) + 1,
      role: "user",
      blocks: [{ kind: "text", text }],
      createdAt: new Date().toISOString(),
    };
    setSnapshot((prev) =>
      prev
        ? {
            ...prev,
            cursor: prev.cursor + 1,
            run: {
              id: "pending",
              botId: active.id,
              threadId: prev.threadId,
              taskId: "pending",
              status: "running",
              trigger: "user",
              modelProvider: null,
              modelId: null,
              error: null,
              startedAt: new Date().toISOString(),
              completedAt: null,
            },
            messages: [...prev.messages, userMsg],
          }
        : null,
    );

    try {
      const running =
        snapshot?.run && ["running", "queued", "leased"].includes(snapshot.run.status);
      if (running) {
        await rpc.threads.followUp({ botId: active.id, text });
      } else {
        await rpc.threads.send({ botId: active.id, text });
      }
      await refreshThread(active.id);
    } catch (err) {
      console.error("Failed to send message", err);
      setRunNotice(err instanceof Error ? err.message : "Could not send message");
      await refreshThread(active.id).catch(() => undefined);
    }
  }

  async function createBot(input: { name: string; title: string; description: string }) {
    const bot = await rpc.bots.create({
      name: input.name.trim(),
      title: input.title,
      description: input.description,
      instructions: input.description,
      notifyOnFinish: true,
    });
    await refreshBots();
    navigate(`/app/${bot.id}`);
    setPanel(null);
  }

  async function bootComputer({
    takeControl,
    overlay,
    force = false,
  }: {
    takeControl: boolean;
    overlay: boolean;
    force?: boolean;
  }) {
    if (!active) return;
    const needsBoot = force || computer?.state !== "running" || !screenUrl;
    if (overlay && needsBoot) setBooting(true);
    try {
      if (needsBoot) await rpc.computer.boot({ botId: active.id });
      if (takeControl) await rpc.computer.takeover({ botId: active.id });
      await refreshThread(active.id);
    } finally {
      setBooting(false);
    }
  }

  useEffect(() => {
    if (panel !== "computer") {
      autoBooted.current = null;
      return;
    }
    if (!active) return;
    if (computer?.state === "booting" || computer?.state === "suspended") return;
    if (autoBooted.current === active.id && computer?.state === "running" && screenUrl) return;
    autoBooted.current = active.id;
    void bootComputer({
      takeControl: false,
      overlay: computer?.state !== "running",
      force: true,
    });
  }, [panel, active?.id, computer?.state, screenUrl]);

  useEffect(() => {
    setComputerOpen(false);
  }, [active?.id]);

  useEffect(() => {
    if (!computerOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setComputerOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [computerOpen]);

  useEffect(() => {
    if ((panel !== "computer" && !computerOpen) || !active || computer?.state !== "running") return;
    const ping = () => void rpc.computer.heartbeat({ botId: active.id }).catch(() => undefined);
    ping();
    const timer = window.setInterval(ping, 60_000);
    return () => window.clearInterval(timer);
  }, [panel, computerOpen, active?.id, computer?.state]);

  async function openComputer() {
    if (!active) return;
    const needsTakeover = computer?.controlHolder !== "user";
    await bootComputer({
      takeControl: needsTakeover,
      overlay: needsTakeover || computer?.state !== "running",
      force: computer?.state !== "running",
    });
    setComputerOpen(true);
  }

  async function releaseComputer() {
    if (!active) return;
    await rpc.computer.release({ botId: active.id }).catch(() => undefined);
    setComputerOpen(false);
    await refreshThread(active.id);
  }

  const embeddedScreenUrl = embeddableScreenUrl(screenUrl);

  const userName = session.data?.user.name ?? "You";
  const initials = userName
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative flex h-full min-w-0 overflow-hidden bg-[#050506] text-[#DFDFE2]">
      <HostComputerPrompt />
      <aside className="flex w-[316px] shrink-0 flex-col border-r border-[#171719] bg-[#0B0B0C]">
        <div className="app-drag flex items-center justify-between px-[18px] pb-3 pt-4">
          <WindowChrome />
          <button
            type="button"
            onClick={() => setPanel("create")}
            className="app-no-drag grid h-7 w-7 place-items-center rounded-lg text-[#C9C9CE] hover:bg-[#1A1A1D] hover:text-white"
            title="New bot"
            aria-label="New bot"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="mx-3.5 mb-3 flex items-center gap-2.5 rounded-xl border border-[#202023] bg-[#141416] px-3 py-2 text-[14px] text-[#6C6C70]">
          <SearchIcon className="h-4 w-4 shrink-0 text-[#6C6C70]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="w-full bg-transparent outline-none"
          />
        </div>
        <div className="rk-scroll flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-2.5">
          {filtered.map((bot) => (
            <button
              key={bot.id}
              type="button"
              onClick={() => navigate(`/app/${bot.id}`)}
              className="flex gap-3 rounded-xl px-2.5 py-[11px] text-left"
              style={{
                background: active?.id === bot.id ? "#161618" : "transparent",
              }}
            >
              <BotAvatar color={bot.color} size={38} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[15px] font-medium text-[#ECECEE]">{bot.name}</span>
                  <span className="shrink-0 text-[12.5px] text-[#6C6C70]">
                    {bot.status === "idle" ? "" : bot.status}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[13.5px] text-[#85858A]">
                  {bot.preview || bot.title}
                </div>
              </div>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setMemoryOpen(true)}
          className="mx-3 mb-1 flex items-center gap-3 rounded-[11px] px-2.5 py-2 hover:bg-[#131315] transition-colors"
        >
          <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-[#17171A] text-[#9A9AA0] shrink-0">
            <FileTextIcon className="h-4 w-4 text-zinc-400" />
          </span>
          <span className="text-[14.5px] text-[#C9C9CE]">Memory</span>
        </button>
        <button
          type="button"
          onClick={() => setPluginsOpen(true)}
          className="mx-3 mb-1 flex items-center gap-3 rounded-[11px] px-2.5 py-2 hover:bg-[#131315] transition-colors"
        >
          <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-[#17171A] text-[#9A9AA0] shrink-0">
            <PuzzleIcon className="h-4 w-4 text-zinc-400" />
          </span>
          <span className="text-[14.5px] text-[#C9C9CE]">Plugins</span>
        </button>
        <div className="relative">
          {menuOpen ? (
            <div className="absolute bottom-14 left-3 right-3 rounded-2xl border border-[#2A2A2F] bg-[#1A1A1D] p-2 shadow-[0_22px_50px_rgba(0,0,0,.55)]">
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-[11px] px-3 py-2 text-left hover:bg-[#232327] transition-colors"
                onClick={() => {
                  setSettingsTab("general");
                  setSettingsModalOpen(true);
                  setMenuOpen(false);
                }}
              >
                <span className="grid h-4 w-4 place-items-center shrink-0 text-[#9A9AA0]">
                  <SettingsIcon className="h-4 w-4" />
                </span>
                <span className="flex-1 text-[14px] text-[#ECECEE]">Preferences</span>
                <span className="text-[11px] font-mono text-[#6C6C70]">⌘,</span>
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-[11px] px-3 py-2 text-left hover:bg-[#232327] transition-colors"
                onClick={() => {
                  setSettingsTab("models");
                  setSettingsModalOpen(true);
                  setMenuOpen(false);
                }}
              >
                <span className="grid h-4 w-4 place-items-center shrink-0 text-[#9A9AA0]">
                  <KeyIcon className="h-4 w-4" />
                </span>
                <span className="flex-1 text-[14px] text-[#ECECEE]">AI Models & Keys</span>
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-[11px] px-3 py-2 text-left hover:bg-[#232327] transition-colors"
                onClick={() => {
                  setSettingsTab("usage");
                  setSettingsModalOpen(true);
                  setMenuOpen(false);
                }}
              >
                <span className="grid h-4 w-4 place-items-center shrink-0 text-[#9A9AA0]">
                  <PieChartIcon className="h-4 w-4" />
                </span>
                <span className="flex-1 text-[14px] text-[#ECECEE]">Usage & Analytics</span>
              </button>
              <div className="my-1 border-t border-[#232327]" />
              <button
                type="button"
                onClick={() => void authClient.signOut().then(() => navigate("/"))}
                className="flex w-full items-center gap-3 rounded-[11px] px-3 py-2 text-left hover:bg-[#232327] transition-colors"
              >
                <span className="grid h-4 w-4 place-items-center shrink-0 text-[#9A9AA0]">
                  <LogOutIcon className="h-4 w-4" />
                </span>
                <span className="text-[14px] text-[#ECECEE]">Log out</span>
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-[11px] px-[18px] py-3.5"
          >
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[#232326] text-[12px] text-[#A8A8AD]">
              {initials}
            </span>
            <span className="text-[14.5px] text-[#C9C9CE]">{userName}</span>
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-[#0D0D0E]">
        <div className="flex items-center justify-between border-b border-[#141416] px-[22px] py-[17px]">
          <button
            type="button"
            onClick={() => setPanel("settings")}
            className="flex min-w-0 items-center gap-3"
          >
            {active ? <BotAvatar color={active.color} size={26} /> : null}
            <span className="min-w-0">
              <span className="block truncate text-[16px] font-medium text-[#ECECEE]">
                {active?.name ?? "Select a bot"}
              </span>
            </span>
          </button>
          <button
            type="button"
            title="Agent computer"
            onClick={() => setPanel((p) => (p === "computer" ? null : "computer"))}
            className="grid h-[30px] w-[34px] place-items-center rounded-[9px] hover:bg-[#1B1B1E]"
            style={{ background: panel ? "#1B1B1E" : "transparent" }}
          >
            <MonitorIcon className="h-4 w-4 text-zinc-400" />
          </button>
        </div>
        <div
          className="rk-scroll flex flex-1 flex-col gap-[13px] overflow-y-auto px-7 py-6"
          data-stream-pace={prefs.streamSpeed}
        >
          {(snapshot?.messages ?? []).map((message) => (
            <MessageView
              key={message.id}
              message={message}
              onOpenBot={(id) => navigate(`/app/${id}`)}
              onStopSubagent={
                active
                  ? (agentId) => void rpc.threads.stopSubagent({ botId: active.id, agentId })
                  : undefined
              }
              onAnswer={(text) =>
                active &&
                rpc.threads.answer({ botId: active.id, runId: message.runId ?? "", answer: text })
              }
            />
          ))}
          {runNotice ? (
            <div className="flex items-center justify-between rounded-xl border border-[#2A2A2F] bg-[#161618] px-3.5 py-2 text-[13px] text-[#C9C9CE]">
              <span>{runNotice}</span>
              <button type="button" className="text-[#85858A]" onClick={() => setRunNotice(null)}>
                Dismiss
              </button>
            </div>
          ) : null}
          {snapshot?.run &&
          ["running", "queued", "leased"].includes(snapshot.run.status) &&
          !snapshot.messages.some((m) => m.id.startsWith("progress:")) ? (
            <div className="flex justify-start">
              <div className="flex flex-col gap-2 rounded-2xl border border-zinc-800/80 bg-zinc-950/60 p-3.5 shadow-sm max-w-[420px]">
                <div className="flex items-center gap-2">
                  <BrainIcon className="h-3.5 w-3.5 text-emerald-400 animate-pulse shrink-0" />
                  <span className="shimmer-text text-[13.5px] font-medium tracking-tight">
                    Thinking…
                  </span>
                </div>
                <div className="flex flex-col gap-1.5 pt-0.5">
                  <div className="shimmer-line h-2 w-48" />
                  <div className="shimmer-line h-2 w-64" />
                  <div className="shimmer-line h-2 w-36" />
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <section
          aria-label="Chat composer"
          className="px-6 pb-6 pt-3"
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            void handleFileSelect(e.dataTransfer.files);
          }}
        >
          {attachedFiles.length > 0 ? (
            <div className="mb-2.5 flex flex-wrap gap-2 px-1">
              {attachedFiles.map((file, idx) => (
                <div
                  key={`${file.name}-${idx}`}
                  className="flex items-center gap-2 rounded-lg border border-[#2B2B30] bg-[#161618] px-2.5 py-1 text-[13px] text-[#ECECEE]"
                >
                  <FileTextIcon className="h-3.5 w-3.5 text-[#9A9AA0]" />
                  <span className="max-w-[180px] truncate">{file.name}</span>
                  <span className="text-[11px] text-[#6C6C70]">
                    ({(file.size / 1024).toFixed(1)} KB)
                  </span>
                  <button
                    type="button"
                    onClick={() => setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))}
                    className="ml-0.5 text-[#85858A] hover:text-[#ECECEE]"
                    title="Remove attachment"
                  >
                    <CloseIcon className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div
            className={`relative flex items-center gap-3.5 rounded-full border bg-[#131315] py-[9px] pr-2.5 pl-3 transition-colors ${
              isDragging ? "border-[#4ECB71] bg-[#171A18]" : "border-[#202023]"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(e) => {
                void handleFileSelect(e.target.files);
                e.target.value = "";
              }}
              className="hidden"
            />

            <div className="relative" ref={attachMenuRef}>
              {attachMenuOpen ? (
                <div className="absolute bottom-12 left-0 z-40 w-56 rounded-2xl border border-[#2A2A2F] bg-[#1A1A1D] p-1.5 shadow-[0_20px_45px_rgba(0,0,0,.6)]">
                  <button
                    type="button"
                    onClick={() => {
                      fileInputRef.current?.click();
                      setAttachMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] text-[#ECECEE] hover:bg-[#26262B] transition-colors"
                  >
                    <span className="grid h-4 w-4 place-items-center shrink-0 text-[#A8A8AD]">
                      <PaperclipIcon className="h-4 w-4" />
                    </span>
                    <span>Upload file</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPanel("routine");
                      setAttachMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] text-[#ECECEE] hover:bg-[#26262B] transition-colors"
                  >
                    <span className="grid h-4 w-4 place-items-center shrink-0 text-[#A8A8AD]">
                      <ClockIcon className="h-4 w-4" />
                    </span>
                    <span>New routine</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void openComputer();
                      setAttachMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] text-[#ECECEE] hover:bg-[#26262B] transition-colors"
                  >
                    <span className="grid h-4 w-4 place-items-center shrink-0 text-[#A8A8AD]">
                      <MonitorIcon className="h-4 w-4" />
                    </span>
                    <span>Open computer</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMemoryOpen(true);
                      setAttachMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] text-[#ECECEE] hover:bg-[#26262B] transition-colors"
                  >
                    <span className="grid h-4 w-4 place-items-center shrink-0 text-[#A8A8AD]">
                      <FileTextIcon className="h-4 w-4" />
                    </span>
                    <span>Memory</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPluginsOpen(true);
                      setAttachMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] text-[#ECECEE] hover:bg-[#26262B] transition-colors"
                  >
                    <span className="grid h-4 w-4 place-items-center shrink-0 text-[#A8A8AD]">
                      <PuzzleIcon className="h-4 w-4" />
                    </span>
                    <span>Plugins & tools</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsTab("models");
                      setSettingsModalOpen(true);
                      setAttachMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] text-[#ECECEE] hover:bg-[#26262B] transition-colors"
                  >
                    <span className="grid h-4 w-4 place-items-center shrink-0 text-[#A8A8AD]">
                      <SettingsIcon className="h-4 w-4" />
                    </span>
                    <span>AI Models & Settings</span>
                  </button>
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => setAttachMenuOpen((v) => !v)}
                aria-label="Add attachment or action"
                title="Attach file or action"
                className={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full border transition-colors ${
                  attachMenuOpen
                    ? "border-[#45454C] bg-[#222226] text-[#ECECEE]"
                    : "border-[#26262A] text-[#9A9AA0] hover:border-[#38383D] hover:bg-[#1B1B1E] hover:text-[#ECECEE]"
                }`}
              >
                <PlusIcon className="h-4 w-4" />
              </button>
            </div>

            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={active ? `Message ${active.name}` : "Message…"}
              className="flex-1 bg-transparent text-[15.5px] text-[#E9E9EA] outline-none"
            />
            {snapshot?.run && ["running", "queued", "leased"].includes(snapshot.run.status) ? (
              <button
                type="button"
                onClick={async () => {
                  if (!active) return;
                  setSnapshot((prev) =>
                    prev
                      ? {
                          ...prev,
                          run: null,
                          messages: prev.messages.filter((m) => !m.id.startsWith("progress:")),
                        }
                      : null,
                  );
                  await rpc.threads.stop({ botId: active.id }).catch(() => undefined);
                  setTimeout(() => {
                    void refreshThread(active.id).catch(() => undefined);
                  }, 150);
                }}
                className="grid h-9 w-9 place-items-center rounded-full border border-[#3A3A40] text-[#ECECEE] hover:bg-[#222226] hover:scale-105 active:scale-95 transition-all cursor-pointer"
                title="Stop generation"
              >
                <StopIcon className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void send()}
              disabled={!draft.trim() && attachedFiles.length === 0}
              className="grid h-9 w-9 place-items-center rounded-full bg-[#F1F1EF] text-[#17171A] hover:bg-white hover:scale-105 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100 transition-all shadow-sm cursor-pointer"
              title={
                snapshot?.run && ["running", "queued", "leased"].includes(snapshot.run.status)
                  ? "Add a follow-up while this run is in progress"
                  : "Send message"
              }
            >
              <SendIcon className="h-4 w-4" />
            </button>
          </div>
        </section>
      </main>

      <aside
        className={`flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-[#0A0A0B] transition-[width] duration-200 ease-out ${
          panel && active ? "w-[384px] border-l border-[#141416]" : "w-0"
        }`}
      >
        {panel && active ? (
          <div className="rk-scroll h-full w-[384px] overflow-y-auto px-5 py-[17px]">
            {panel !== "routine" && panel !== "create" ? (
              <div className="mb-4 flex items-center justify-between">
                <span className="text-[13.5px] text-[#85858A]">
                  {computer?.state ?? active.status}
                </span>
                <div className="flex gap-3.5">
                  <button
                    type="button"
                    onClick={() => setPanel("settings")}
                    aria-label="Settings"
                    className="text-[#85858A] hover:text-[#ECECEE]"
                  >
                    <SettingsIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanel(null)}
                    aria-label="Close panel"
                    className="text-[#85858A] hover:text-[#ECECEE]"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : null}
            {panel === "computer" ? (
              <div>
                <div className="relative aspect-[16/10] overflow-hidden rounded-[14px] bg-[#0E0E10]">
                  {computerOpen ? (
                    <div className="grid h-full place-items-center text-sm text-[#6C6C70]">
                      Open in full window
                    </div>
                  ) : computer?.kind === "desktop" ? (
                    <div className="grid h-full place-items-center px-6 text-center text-sm text-[#6C6C70]">
                      This bot runs on this computer, not a Linux desktop. Shell and files use your
                      home folder.
                    </div>
                  ) : computer?.state === "running" && embeddedScreenUrl ? (
                    <iframe
                      title="Bot screen preview"
                      src={embeddedScreenUrl}
                      sandbox={screenIframeSandbox(embeddedScreenUrl)}
                      className="h-full w-full border-0 bg-black"
                      allow="clipboard-read; clipboard-write"
                      style={{ pointerEvents: "none" }}
                    />
                  ) : (
                    <div className="grid h-full place-items-center text-sm text-[#6C6C70]">
                      {computer?.state === "booting" || booting
                        ? "Booting live desktop…"
                        : computer?.state === "running"
                          ? `${active.name}’s screen`
                          : computer?.state === "suspended"
                            ? "Computer is asleep — take control to wake it"
                            : computer?.state === "error"
                              ? "Computer failed to boot"
                              : "Computer is stopped"}
                    </div>
                  )}
                  <button
                    type="button"
                    className="absolute inset-0 cursor-pointer"
                    aria-label="Open computer"
                    onClick={() => void openComputer()}
                  />
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[13.5px] text-[#85858A]">
                    {computer?.controlHolder === "user"
                      ? "You have control"
                      : computer?.state === "suspended"
                        ? "Asleep"
                        : `${active.name}’s screen`}
                  </span>
                  {computer?.controlHolder === "user" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void releaseComputer()}
                    >
                      Release
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void openComputer()}
                    >
                      Take control
                    </Button>
                  )}
                </div>
                <div className="mt-[30px] mb-3 text-[14px] text-[#85858A]">Routines</div>
                {routines.map((routine) => (
                  <button
                    key={routine.id}
                    type="button"
                    onClick={() => {
                      setRoutineDraft({
                        name: routine.name,
                        prompt: routine.prompt,
                        schedule: presetFromCron(routine.cron),
                      });
                      setPanel("routine");
                    }}
                    className="flex w-full items-center gap-3 rounded-[11px] px-2.5 py-2.5 hover:bg-[#121214]"
                  >
                    <ClockIcon className="h-4 w-4 text-[#E65707]" />
                    <span className="flex-1 text-left text-[14.5px] text-[#ECECEE]">
                      {routine.name}
                    </span>
                    <span className="text-[13px] text-[#6C6C70]">{formatCron(routine.cron)}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={async () => {
                    const first = routines[0];
                    if (first) {
                      await rpc.routines.testRun({ routineId: first.id });
                      await refreshThread(active.id);
                    } else {
                      setRoutineDraft({ name: "", prompt: "", schedule: defaultCronPreset() });
                      setPanel("routine");
                    }
                  }}
                  className="mt-1 flex items-center gap-2.5 px-2.5 py-2.5 text-[14.5px] text-[#7A7A80]"
                >
                  Run now
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRoutineDraft({ name: "", prompt: "", schedule: defaultCronPreset() });
                    setPanel("routine");
                  }}
                  className="mt-1 flex items-center gap-2.5 px-2.5 py-2.5 text-[14.5px] text-[#7A7A80]"
                >
                  + New routine
                </button>
              </div>
            ) : null}
            {panel === "create" ? (
              <CreateBotForm
                onCancel={() => setPanel(null)}
                onCreate={(input) => void createBot(input)}
              />
            ) : null}
            {panel === "settings" ? (
              <BotSettings
                key={active.id}
                bot={active}
                onSave={async (patch) => {
                  await rpc.bots.update({ botId: active.id, ...patch });
                  await refreshBots();
                }}
                onExport={async () => {
                  const manifest = await rpc.export.bot({ botId: active.id });
                  const blob = new Blob([JSON.stringify(manifest, null, 2)], {
                    type: "application/json",
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${active.name.toLowerCase().replace(/\s+/g, "-")}-export.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                onDelete={async () => {
                  await rpc.bots.remove({ botId: active.id });
                  setPanel(null);
                  await refreshBots();
                }}
              />
            ) : null}
            {panel === "routine" ? (
              <div>
                <div className="mb-5 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setPanel("computer")}
                    className="text-[#9A9AA0] hover:text-[#ECECEE]"
                    aria-label="Back to computer"
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </button>
                  <div className="text-[15.5px] font-medium text-[#F1F1F2]">Routine</div>
                  <button
                    type="button"
                    onClick={() => setPanel(null)}
                    className="text-[#6C6C70] hover:text-[#ECECEE]"
                    aria-label="Close routine panel"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </div>
                <label className="text-[14px] text-[#85858A]">
                  Name
                  <input
                    value={routineDraft.name}
                    onChange={(e) => setRoutineDraft((s) => ({ ...s, name: e.target.value }))}
                    className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
                  />
                </label>
                <label className="mt-5 block text-[14px] text-[#85858A]">
                  Instruction
                  <textarea
                    value={routineDraft.prompt}
                    onChange={(e) => setRoutineDraft((s) => ({ ...s, prompt: e.target.value }))}
                    rows={4}
                    className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
                  />
                </label>
                <div className="mt-5 text-[14px] text-[#85858A]">
                  When to run
                  <RoutineSchedule
                    value={routineDraft.schedule}
                    onChange={(schedule) => setRoutineDraft((s) => ({ ...s, schedule }))}
                  />
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await rpc.routines.create({
                      botId: active.id,
                      name: routineDraft.name || "Routine",
                      prompt: routineDraft.prompt || "Check in.",
                      cron: cronFromPreset(routineDraft.schedule),
                      timezone: "UTC",
                      active: true,
                      notify: true,
                    });
                    await refreshThread(active.id);
                    setPanel("computer");
                  }}
                  className="mt-5 rounded-[11px] bg-[#F1F1EF] px-4 py-2 text-[#17171A]"
                >
                  Save
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </aside>

      {pluginsOpen ? (
        <PluginsOverlay
          onClose={() => setPluginsOpen(false)}
          onOpenSettings={() => {
            setSettingsTab("plugins");
            setSettingsModalOpen(true);
          }}
        />
      ) : null}

      {memoryOpen && active ? (
        <MemoryOverlay botId={active.id} onClose={() => setMemoryOpen(false)} />
      ) : null}

      {settingsModalOpen ? (
        <SettingsModal initialTab={settingsTab} onClose={() => setSettingsModalOpen(false)} />
      ) : null}

      {booting ? (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-[22px] bg-[rgba(4,4,5,.96)]">
          <div className="text-[19px] font-medium text-[#F1F1F2]">
            Booting up {active?.name}’s computer
          </div>
          <div className="h-[5px] w-[min(420px,70%)] overflow-hidden rounded-full bg-[#232327]">
            <div className="h-full w-2/3 rounded-full bg-[#F1F1EF]" />
          </div>
        </div>
      ) : computerOpen && active ? (
        <div className="absolute inset-0 z-30 flex flex-col bg-[#050506]">
          <div className="app-drag flex items-center justify-between gap-4 border-b border-[#171719] px-[18px] py-3.5">
            <div className="app-no-drag flex min-w-0 items-center gap-3">
              <WindowChrome />
              <BotAvatar color={active.color} size={28} />
              <span className="truncate text-[15.5px] font-medium text-[#ECECEE]">
                {active.name}’s computer
              </span>
              {computer?.controlHolder === "user" ? (
                <span className="rounded-full bg-[rgba(48,162,75,.14)] px-[11px] py-1 text-[13px] text-[#4ECB71]">
                  You have control
                </span>
              ) : null}
            </div>
            <div className="app-no-drag flex items-center gap-3">
              {computer?.controlHolder === "user" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void releaseComputer()}
                >
                  Release
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void bootComputer({ takeControl: true, overlay: false })}
                >
                  Take control
                </Button>
              )}
              <button
                type="button"
                className="text-[#85858A] hover:text-[#ECECEE]"
                aria-label="Close computer"
                onClick={() => setComputerOpen(false)}
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 bg-[#0E0E10]">
            {computer?.kind === "desktop" ? (
              <div className="grid h-full place-items-center px-8 text-center text-sm text-[#6C6C70]">
                This bot runs on this computer. There is no separate Linux desktop. Ask it to use
                the shell; working directories under your home folder are allowed.
              </div>
            ) : computer?.state === "running" && embeddedScreenUrl ? (
              <iframe
                title="Bot screen"
                src={embeddedScreenUrl}
                sandbox={screenIframeSandbox(embeddedScreenUrl)}
                className="h-full w-full border-0 bg-black"
                allow="clipboard-read; clipboard-write; fullscreen"
                style={{ pointerEvents: computer?.controlHolder === "user" ? "auto" : "none" }}
              />
            ) : (
              <div className="grid h-full place-items-center text-sm text-[#6C6C70]">
                {computer?.state === "suspended" ? "Computer is asleep" : `${active.name}’s screen`}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function applyThreadEvent(
  event: ProductEvent,
  setSnapshot: Dispatch<SetStateAction<ThreadSnapshot | null>>,
  setComputer: Dispatch<SetStateAction<ComputerStatus | null>>,
) {
  if (event.type === "thread.progress") {
    const text = String(event.payload.text ?? "");
    const thought = event.payload.thought ? String(event.payload.thought) : undefined;
    setSnapshot((prev) => {
      if (!prev) return prev;
      const streaming: ThreadMessage = {
        id: `progress:${event.runId ?? event.id}`,
        threadId: event.threadId,
        seq: event.seq,
        role: "bot",
        blocks: [{ kind: "progress", text, thought }],
        runId: event.runId,
        createdAt: event.createdAt,
      };
      const without = prev.messages.filter((message) => !message.id.startsWith("progress:"));
      return { ...prev, cursor: event.seq, messages: [...without, streaming] };
    });
    return;
  }
  if (event.type === "thread.subagent") {
    const block = subagentBlockFromPayload(event.payload);
    const next: ThreadMessage = {
      id: `subagent:${block.agentId}`,
      threadId: event.threadId,
      seq: event.seq,
      role: "bot",
      blocks: [block],
      runId: event.runId,
      createdAt: event.createdAt,
    };
    setSnapshot((prev) => {
      if (!prev) return prev;
      const without = prev.messages.filter(
        (message) => message.id !== next.id && !message.id.startsWith("progress:"),
      );
      const progress = prev.messages.filter((message) => message.id.startsWith("progress:"));
      return { ...prev, cursor: event.seq, messages: [...without, next, ...progress] };
    });
    return;
  }
  if (event.type === "thread.message.created") {
    const role = (event.payload.role as ThreadMessage["role"]) ?? "bot";
    const blocks = (event.payload.blocks as ThreadMessage["blocks"]) ?? [];
    const next: ThreadMessage = {
      id: String(event.payload.messageId ?? event.id),
      threadId: event.threadId,
      seq: event.seq,
      role,
      blocks,
      runId: event.runId,
      createdAt: event.createdAt,
    };
    setSnapshot((prev) => {
      if (!prev) return prev;
      const without = prev.messages.filter(
        (message) =>
          message.id !== next.id &&
          !message.id.startsWith("progress:") &&
          !replacedSubagent(message, blocks) &&
          !replacedTool(message, blocks),
      );
      return { ...prev, cursor: event.seq, messages: [...without, next] };
    });
    return;
  }
  if (
    event.type === "run.completed" ||
    event.type === "run.failed" ||
    event.type === "run.cancelled"
  ) {
    setSnapshot((prev) => {
      if (!prev) return prev;
      const without = prev.messages.filter((m) => !m.id.startsWith("progress:"));
      return {
        ...prev,
        cursor: event.seq,
        run: null,
        messages: without,
      };
    });
    return;
  }
  if (event.type === "thread.tool") {
    const block = toolBlockFromPayload(event.payload);
    const next: ThreadMessage = {
      id: `tool:${block.executionId}`,
      threadId: event.threadId,
      seq: event.seq,
      role: "bot",
      blocks: [block],
      runId: event.runId,
      createdAt: event.createdAt,
    };
    setSnapshot((prev) => {
      if (!prev) return prev;
      const without = prev.messages.filter(
        (message) => message.id !== next.id && !message.id.startsWith("progress:"),
      );
      const progress = prev.messages.filter((message) => message.id.startsWith("progress:"));
      return { ...prev, cursor: event.seq, messages: [...without, next, ...progress] };
    });
    return;
  }
  if (event.type === "run.started") {
    setSnapshot((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        cursor: event.seq,
        run: {
          id: event.runId ?? "",
          botId: event.botId ?? "",
          threadId: event.threadId ?? prev.threadId,
          taskId: String(event.payload.taskId ?? ""),
          status: "running",
          trigger: "user",
          modelProvider: null,
          modelId: null,
          error: null,
          startedAt: event.createdAt,
          completedAt: null,
        },
      };
    });
    return;
  }
  if (event.type === "computer.status" || event.type === "computer.takeover.granted") {
    const status = String(event.payload.status ?? "");
    setComputer((prev) =>
      prev
        ? {
            ...prev,
            controlHolder: event.type === "computer.takeover.granted" ? "user" : prev.controlHolder,
            state:
              event.type === "computer.status" &&
              ["stopped", "booting", "running", "suspended", "error"].includes(status)
                ? (status as ComputerStatus["state"])
                : prev.state,
            screenAvailable: status === "running" || status === "booting" || prev.screenAvailable,
          }
        : prev,
    );
  }
}

function replacedSubagent(message: ThreadMessage, blocks: ThreadMessage["blocks"]) {
  const agentIds = new Set(
    blocks.filter((block) => block.kind === "subagent").map((block) => block.agentId),
  );
  if (agentIds.size === 0) return false;
  return message.blocks.some((block) => block.kind === "subagent" && agentIds.has(block.agentId));
}

function replacedTool(message: ThreadMessage, blocks: ThreadMessage["blocks"]) {
  const ids = new Set(
    blocks.filter((block) => block.kind === "tool").map((block) => block.executionId),
  );
  if (ids.size === 0) return false;
  return (
    message.id.startsWith("tool:") &&
    message.blocks.some((block) => block.kind === "tool" && ids.has(block.executionId))
  );
}

function ThoughtProcess({
  thought,
  isStreaming = false,
}: {
  thought: string;
  isStreaming?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(isStreaming);

  useEffect(() => {
    if (isStreaming) {
      setIsOpen(true);
    }
  }, [isStreaming]);

  if (!thought?.trim()) return null;

  return (
    <div className="mb-2 max-w-[85%]">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="group flex items-center gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-400 transition-all hover:border-zinc-700 hover:bg-zinc-800/60 hover:text-zinc-200"
      >
        <BrainIcon
          className={`h-3.5 w-3.5 text-emerald-400 shrink-0 ${isStreaming ? "animate-pulse" : ""}`}
        />
        <span className="font-medium tracking-tight">
          {isStreaming ? <span className="shimmer-text">Thinking…</span> : "Thought process"}
        </span>
        <ChevronDownIcon
          className={`h-3.5 w-3.5 text-zinc-500 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen ? (
        <div className="mt-1.5 overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-950/80 p-3.5 text-[12.5px] leading-relaxed text-zinc-400 shadow-inner">
          <div className="max-h-72 overflow-y-auto whitespace-pre-wrap font-mono selection:bg-zinc-800 selection:text-zinc-200">
            {thought}
            {isStreaming ? (
              <span className="inline-block h-3.5 w-1.5 ml-0.5 bg-emerald-400/80 animate-pulse align-middle" />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SubagentCard({
  block,
  onOpenBot: _onOpenBot,
  onStop,
}: {
  block: Extract<ThreadMessage["blocks"][number], { kind: "subagent" }>;
  onOpenBot?: (id: string) => void;
  onStop?: (agentId: string) => void;
}) {
  const running = block.status === "running";
  const failed = block.status === "failed";
  const cancelled = block.status === "cancelled";
  const [isExpanded, setIsExpanded] = useState(
    running || Boolean(block.result || (block.actions && block.actions.length > 0)),
  );

  return (
    <div className="w-[min(520px,95%)] overflow-hidden rounded-[18px] border border-[#232326] bg-[#141417] shadow-sm transition-all">
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-zinc-800/80 text-emerald-400 border border-zinc-700/50 shrink-0">
            <CpuIcon className="h-4 w-4" />
          </div>
          <span className="truncate text-[14.5px] font-medium text-[#ECECEE]">{block.name}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {running && onStop ? (
            <button
              type="button"
              onClick={() => onStop(block.agentId)}
              className="rounded-full border border-[#3A3A40] px-2 py-0.5 text-[11px] text-[#ECECEE] hover:bg-[#222226]"
              title="Stop this subagent"
            >
              Stop
            </button>
          ) : null}
          <span
            className="rounded-full px-2.5 py-0.5 text-[11.5px] font-medium uppercase tracking-wider"
            style={{
              background: failed
                ? "rgba(230,87,7,.14)"
                : cancelled
                  ? "rgba(140,140,148,.16)"
                  : running
                    ? "rgba(245,160,60,.14)"
                    : "rgba(48,162,75,.14)",
              color: failed ? "#E65707" : cancelled ? "#A8A8AD" : running ? "#F5A03C" : "#4ECB71",
              animation: running ? "rkPulse 1.2s ease-in-out infinite" : undefined,
            }}
          >
            {running ? "subagent running" : block.status}
          </span>
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
            title={isExpanded ? "Collapse" : "Expand"}
          >
            <ChevronDownIcon
              className={`h-3.5 w-3.5 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      </div>

      <div className="px-4 pb-3">
        <div className="text-[13px] text-[#85858A] leading-normal">{block.task}</div>

        {isExpanded ? (
          <div className="mt-3 flex flex-col gap-2 border-t border-zinc-800/60 pt-3">
            {block.actions && block.actions.length > 0 ? (
              <div className="flex flex-col gap-1 rounded-lg border border-zinc-800 bg-black/40 p-2.5 text-xs font-mono text-zinc-400">
                <span className="text-[10.5px] uppercase font-semibold tracking-wider text-zinc-500 mb-0.5">
                  Subagent Actions ({block.actions.length})
                </span>
                <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                  {block.actions.map((act, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-zinc-300">
                      <TerminalIcon className="h-3 w-3 text-amber-400/80 shrink-0" />
                      <span className="truncate">{act}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {block.progress && running ? (
              <div className="flex items-center gap-2 text-[12.5px] text-zinc-400 font-mono italic">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping shrink-0" />
                <span className="truncate">{block.progress}</span>
              </div>
            ) : null}

            {block.result ? (
              <div className="rounded-lg bg-zinc-900/60 p-3 text-[14px] leading-relaxed text-[#DFDFE2]">
                <ChatMarkdown streaming={running}>{block.result}</ChatMarkdown>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ToolCard({
  block,
}: {
  block: Extract<ThreadMessage["blocks"][number], { kind: "tool" }>;
}) {
  const running = block.status === "running";
  const failed = block.status === "failed";
  return (
    <div className="w-[min(520px,95%)] overflow-hidden rounded-[16px] border border-[#232326] bg-[#121215] px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <TerminalIcon className="h-3.5 w-3.5 shrink-0 text-amber-400/80" />
          <span className="truncate font-mono text-[13px] text-[#ECECEE]">{block.name}</span>
        </div>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] uppercase tracking-wide"
          style={{
            color: failed ? "#E65707" : running ? "#F5A03C" : "#4ECB71",
          }}
        >
          {block.status}
        </span>
      </div>
      {block.detail ? (
        <div className="mt-1.5 truncate font-mono text-[12px] text-[#85858A]">{block.detail}</div>
      ) : null}
      {block.result && !running ? (
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[11.5px] text-[#A8A8AD]">
          {block.result.slice(0, 1200)}
        </pre>
      ) : null}
    </div>
  );
}

function MessageView({
  message,
  onAnswer,
  onOpenBot,
  onStopSubagent,
}: {
  message: ThreadMessage;
  onAnswer: (text: string) => void;
  onOpenBot: (botId: string) => void;
  onStopSubagent?: (agentId: string) => void;
}) {
  return (
    <>
      {message.blocks.map((block, i) => {
        if (block.kind === "meta") {
          return (
            <div
              key={i}
              className="flex items-center justify-center gap-2 py-1 text-[13.5px] text-[#85858A]"
            >
              <span className="text-[#E65707]">◷</span>
              <span>{block.text}</span>
            </div>
          );
        }
        if (block.kind === "progress") {
          return (
            <div key={i} className="flex flex-col items-start gap-1">
              {block.thought ? <ThoughtProcess thought={block.thought} isStreaming={true} /> : null}
              {block.text ? (
                <div className="max-w-[74%] rounded-[20px] bg-[#1A1A1D] px-[18px] py-3 text-[15.5px] leading-[1.5] text-[#DFDFE2]">
                  <ChatMarkdown streaming>{block.text}</ChatMarkdown>
                </div>
              ) : !block.thought ? (
                <div className="flex items-center gap-2 rounded-xl border border-zinc-800/60 bg-zinc-950/60 px-3.5 py-2 text-xs text-zinc-400">
                  <BrainIcon className="h-3.5 w-3.5 text-emerald-400 animate-pulse shrink-0" />
                  <span className="shimmer-text font-medium">Thinking…</span>
                </div>
              ) : null}
            </div>
          );
        }
        if (block.kind === "subagent") {
          return (
            <div key={i} className="flex justify-start">
              <SubagentCard block={block} onOpenBot={onOpenBot} onStop={onStopSubagent} />
            </div>
          );
        }
        if (block.kind === "tool") {
          return (
            <div key={i} className="flex justify-start">
              <ToolCard block={block} />
            </div>
          );
        }
        if (block.kind === "child_bot") {
          const deleted = block.status === "deleted";
          return (
            <button
              key={i}
              type="button"
              disabled={deleted}
              onClick={() => onOpenBot(block.botId)}
              className="w-[min(340px,90%)] rounded-[18px] border border-[#232326] bg-[#17171A] px-[18px] py-4 text-left disabled:opacity-60"
            >
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-medium text-[#ECECEE]">{block.name}</span>
                <span
                  className="rounded-full px-[11px] py-1 text-[13px]"
                  style={{
                    background: deleted ? "rgba(230,87,7,.14)" : "rgba(48,162,75,.14)",
                    color: deleted ? "#E65707" : "#4ECB71",
                  }}
                >
                  {deleted ? "deleted" : "bot"}
                </span>
              </div>
              <div className="mt-2 text-[14.5px] leading-[1.5] text-[#A8A8AD]">
                {deleted
                  ? "Removed this bot, including its chat, computer, and memory."
                  : block.title || "Opened its own thread. Tap to switch."}
              </div>
            </button>
          );
        }
        if (block.kind === "text" && message.role === "user") {
          return (
            <div key={i} className="flex justify-end">
              <div className="max-w-[70%] rounded-[20px] bg-[#F1F1EF] px-[18px] py-3 text-[15.5px] leading-[1.45] text-[#1A1A1A]">
                {block.text}
              </div>
            </div>
          );
        }
        if (block.kind === "text") {
          return (
            <div key={i} className="flex flex-col items-start gap-1">
              {block.thought ? (
                <ThoughtProcess thought={block.thought} isStreaming={false} />
              ) : null}
              <div className="max-w-[74%] rounded-[20px] bg-[#1A1A1D] px-[18px] py-3 text-[15.5px] leading-[1.5] text-[#DFDFE2]">
                <ChatMarkdown>{block.text}</ChatMarkdown>
              </div>
            </div>
          );
        }
        if (block.kind === "card") {
          return (
            <div key={i} className="flex justify-start">
              <div className="flex flex-col gap-2 rounded-[20px] bg-[#1A1A1D] px-5 py-4">
                {block.lines.map((line) => (
                  <div key={line.k} className="flex items-baseline gap-2.5 text-[15px]">
                    <CheckIcon className="h-3.5 w-3.5 text-[#30A24B] shrink-0" />
                    <span className="font-semibold text-white">{line.k}</span>
                    <span className="text-[#85858A]">→</span>
                    <span>{line.v}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        }
        if (block.kind === "ask") {
          return (
            <div
              key={i}
              className="max-w-[74%] rounded-[20px] border border-[#242428] bg-[#141417] px-5 py-[17px]"
            >
              <div className="text-[15.5px] leading-[1.5] text-[#ECECEE]">
                <ChatMarkdown>{block.text}</ChatMarkdown>
              </div>
              {block.detail ? (
                <pre className="mt-3 rounded-xl bg-[#0E0E10] px-3.5 py-3 font-mono text-[12.5px] leading-[1.7] text-[#85858A]">
                  {block.detail}
                </pre>
              ) : null}
              <div className="mt-3.5 flex gap-2">
                <button
                  type="button"
                  onClick={() => onAnswer("approved")}
                  className="rounded-[11px] bg-[#F1F1EF] px-[17px] py-2 text-[14.5px] font-medium text-[#17171A]"
                >
                  Send it
                </button>
                <button
                  type="button"
                  className="rounded-[11px] border border-[#26262A] px-[17px] py-2 text-[14.5px] text-[#C9C9CE]"
                >
                  Edit first
                </button>
              </div>
            </div>
          );
        }
        if (block.kind === "computer") {
          return (
            <div
              key={i}
              className="w-[340px] rounded-[18px] border border-[#232326] bg-[#17171A] px-[18px] py-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-medium text-[#ECECEE]">Computer</span>
                <span className="rounded-full bg-[rgba(48,162,75,.14)] px-[11px] py-1 text-[13px] text-[#4ECB71]">
                  {block.state}
                </span>
              </div>
              <div className="my-2.5 text-[14.5px] leading-[1.5] text-[#A8A8AD]">
                <ChatMarkdown>{block.text}</ChatMarkdown>
              </div>
            </div>
          );
        }
        return null;
      })}
    </>
  );
}

function CreateBotForm({
  onCreate,
  onCancel,
}: {
  onCreate: (input: { name: string; title: string; description: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[13.5px] text-[#85858A]">New bot</span>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel new bot"
          className="text-[#85858A] hover:text-[#ECECEE]"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      <label className="mt-6 block text-[14px] text-[#85858A]">
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name this bot"
          className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
        />
      </label>
      <label className="mt-4 block text-[14px] text-[#85858A]">
        Title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Describe what this bot does"
          className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
        />
      </label>
      <label className="mt-4 block text-[14px] text-[#85858A]">
        Description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this bot is for"
          rows={4}
          className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
        />
      </label>
      <button
        type="button"
        disabled={!name.trim()}
        onClick={() => onCreate({ name, title, description })}
        className="mt-5 rounded-[11px] bg-[#F1F1EF] px-4 py-2 text-[#17171A] disabled:opacity-40"
      >
        Create
      </button>
    </div>
  );
}

function BotSettings({
  bot,
  onSave,
  onExport,
  onDelete,
}: {
  bot: Bot;
  onSave: (patch: {
    name?: string;
    title?: string;
    description?: string;
    instructions?: string;
  }) => Promise<void>;
  onExport: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(bot.name);
  const [title, setTitle] = useState(bot.title);
  const [description, setDescription] = useState(bot.description);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <div className="flex justify-center">
        <BotAvatar color={bot.color} size={64} />
      </div>
      <label className="mt-6 block text-[14px] text-[#85858A]">
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
        />
      </label>
      <label className="mt-4 block text-[14px] text-[#85858A]">
        Title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
        />
      </label>
      <label className="mt-4 block text-[14px] text-[#85858A]">
        Description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
        />
      </label>
      <div className="mt-5 flex flex-col items-start gap-3">
        <button
          type="button"
          onClick={() => void onSave({ name, title, description, instructions: description })}
          className="rounded-[11px] bg-[#F1F1EF] px-4 py-2 text-[#17171A]"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => void onExport()}
          className="text-[14px] text-[#85858A]"
        >
          Export
        </button>
        {confirming ? (
          <div className="w-full rounded-[11px] border border-[#3A1F14] bg-[#1A100C] px-3.5 py-3">
            <p className="text-[13.5px] leading-[1.45] text-[#C9C9CE]">
              This permanently deletes {bot.name}, including thread, computer, memory, and routines.
              Bots it created stay in your list.
            </p>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  setConfirming(false);
                  setError(null);
                }}
                className="text-[14px] text-[#85858A] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  setDeleting(true);
                  setError(null);
                  void onDelete().catch((err: unknown) => {
                    setError(err instanceof Error ? err.message : "Could not delete bot");
                    setDeleting(false);
                  });
                }}
                className="rounded-[11px] bg-[#E65707] px-3.5 py-1.5 text-[14px] text-[#F1F1EF] disabled:opacity-40"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
            {error ? <p className="mt-2 text-[13px] text-[#E65707]">{error}</p> : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-[14px] text-[#E65707]"
          >
            Delete bot
          </button>
        )}
      </div>
    </div>
  );
}

function embeddableScreenUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    const page = new URL(window.location.href);
    const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    const pagePort = page.port || (page.protocol === "https:" ? "443" : "80");
    if (local && parsed.port && parsed.port !== pagePort) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function screenIframeSandbox(url: string | null) {
  if (!url) return undefined;
  try {
    return new URL(url, window.location.href).pathname.startsWith("/novnc/")
      ? "allow-scripts allow-pointer-lock"
      : undefined;
  } catch {
    return undefined;
  }
}
