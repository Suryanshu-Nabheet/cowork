import { Button, Switch } from "@cowork/ui-web";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIcon,
  BrainIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  CpuIcon,
  FileTextIcon,
  MonitorIcon,
  PuzzleIcon,
  ShieldIcon,
  SlidersIcon,
  TerminalIcon,
  ZapIcon,
} from "../components/icons.js";
import { loadPrefs, playCompletionChime, savePrefs } from "../lib/prefs.js";
import { rpc } from "../lib/rpc.js";

export type SettingsTab =
  | "models"
  | "usage"
  | "ollama"
  | "plugins"
  | "computer"
  | "general"
  | "account";

type ModelEntry = {
  provider: string;
  providerName?: string;
  id: string;
  label: string;
  billing: string;
  auth?: "api-key" | "oauth" | "both";
  oauthLabel?: string;
  subscription?: boolean;
  signIn?: "device-code";
};

type Credential = {
  id: string;
  provider: string;
  label: string;
  hasKey: boolean;
  isDefault: boolean;
};

type UsageRecord = {
  id: string;
  botId: string | null;
  runId: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
};

type UsageSummary = {
  inputTokens: number;
  outputTokens: number;
  runs: number;
};

const POPULAR_MODELS = [
  {
    id: "anthropic:claude-3-7-sonnet",
    name: "Claude 3.7 Sonnet",
    provider: "anthropic",
    tag: "Thinking & Code",
  },
  {
    id: "anthropic:claude-3-5-sonnet",
    name: "Claude 3.5 Sonnet",
    provider: "anthropic",
    tag: "Fast & Accurate",
  },
  { id: "openai:gpt-4o", name: "GPT-4o", provider: "openai", tag: "Multimodal" },
  { id: "openai:o3-mini", name: "o3-mini", provider: "openai", tag: "Reasoning" },
  {
    id: "openrouter:deepseek/deepseek-v4-flash-0731",
    name: "DeepSeek-V3",
    provider: "openrouter",
    tag: "High Speed",
  },
  {
    id: "google:gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "google",
    tag: "1M Context",
  },
  {
    id: "groq:llama-3.3-70b-versatile",
    name: "Llama 3.3 70B",
    provider: "groq",
    tag: "Ultra Fast",
  },
];

const MAJOR_PROVIDERS = [
  {
    id: "anthropic",
    name: "Anthropic Claude",
    placeholder: "sk-ant-api03-...",
    hint: "Claude 3.7, 3.5 Sonnet, Haiku",
  },
  { id: "openai", name: "OpenAI", placeholder: "sk-proj-...", hint: "GPT-4o, o3-mini, GPT-4.5" },
  {
    id: "openrouter",
    name: "OpenRouter",
    placeholder: "sk-or-v1-...",
    hint: "Unified access to 200+ models",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    placeholder: "sk-...",
    hint: "DeepSeek-V3 & R1 reasoning API",
  },
  {
    id: "google",
    name: "Google Gemini",
    placeholder: "AIzaSy...",
    hint: "Gemini 2.0 Flash & 1.5 Pro",
  },
  { id: "groq", name: "Groq Cloud", placeholder: "gsk_...", hint: "Ultra-low latency LPU models" },
];

export function SettingsModal({
  initialTab = "models",
  onClose,
}: {
  initialTab?: SettingsTab;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [_loading, setLoading] = useState(true);
  const [_catalog, setCatalog] = useState<ModelEntry[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [defaultProvider, setDefaultProvider] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [activeKeyInputs, setActiveKeyInputs] = useState<Record<string, string>>({});
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Usage state
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [usageList, setUsageList] = useState<UsageRecord[]>([]);

  // Ollama local state — errors stay on the Ollama tab, not a global banner
  const [ollamaUrl, setOllamaUrl] = useState("http://127.0.0.1:11434");
  const [ollamaStatus, setOllamaStatus] = useState<"idle" | "checking" | "connected" | "error">(
    "idle",
  );
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);

  // General state
  const prefs = loadPrefs();
  const [soundEnabled, setSoundEnabled] = useState(prefs.soundEnabled);
  const [streamSpeed, setStreamSpeed] = useState(prefs.streamSpeed);

  const [me, setMe] = useState<{
    userId: string;
    email?: string | null;
    name?: string | null;
    workspaceId: string;
  } | null>(null);

  const [deployment, setDeployment] = useState<{
    signupsEnabled?: boolean;
    computerHost?: "docker" | "this-mac" | null;
  } | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [meData, models, creds, deploy, summary, list] = await Promise.all([
          rpc.me().catch(() => null),
          rpc.models.list().catch(() => []),
          rpc.models.credentials().catch(() => []),
          rpc.deployment.get().catch(() => null),
          rpc.usage.summary().catch(() => null),
          rpc.usage.list().catch(() => []),
        ]);

        if (meData) {
          setMe(meData);
          setDefaultProvider(meData.defaultProvider ?? "");
          setDefaultModel(meData.defaultModel ?? "");
        }
        setCatalog(models);
        setCredentials(creds);
        setDeployment(deploy);
        setUsageSummary(summary);
        setUsageList(list);
      } catch (err) {
        console.error("Failed to load settings data", err);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  async function handleSaveProviderKey(providerId: string) {
    const key = activeKeyInputs[providerId]?.trim();
    if (!key) return;
    setSavingProvider(providerId);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await rpc.models.connect({
        provider: providerId,
        apiKey: key,
      });
      const creds = await rpc.models.credentials();
      setCredentials(creds);
      setActiveKeyInputs((prev) => ({ ...prev, [providerId]: "" }));
      setSuccessMsg(`Saved key for ${providerId.toUpperCase()}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to connect API key");
    } finally {
      setSavingProvider(null);
    }
  }

  async function handleSelectModel(modelId: string, provider: string) {
    setErrorMsg(null);
    try {
      await rpc.models.setDefault({ provider, modelId });
      setDefaultProvider(provider);
      setDefaultModel(modelId);
      setSuccessMsg(`Default model updated to ${modelId}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to set default model");
    }
  }

  async function checkOllamaConnection() {
    setOllamaStatus("checking");
    setOllamaError(null);
    try {
      const res = await fetch(`${ollamaUrl}/api/tags`).catch(() => null);
      if (res?.ok) {
        const data = (await res.json()) as { models?: Array<{ name: string }> };
        const modelNames = (data.models || []).map((m) => m.name);
        setOllamaModels(modelNames);
        setOllamaStatus("connected");
      } else {
        setOllamaStatus("error");
        setOllamaError("Could not reach Ollama. Ensure `ollama serve` is running.");
      }
    } catch (err) {
      setOllamaStatus("error");
      setOllamaError(err instanceof Error ? err.message : "Failed to connect to Ollama");
    }
  }

  useEffect(() => {
    if (tab === "ollama") void checkOllamaConnection();
  }, [tab]);

  const numFormat = useMemo(() => new Intl.NumberFormat(), []);

  function hasKeyForProvider(providerId: string) {
    return credentials.some((c) => c.provider === providerId && c.hasKey);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 sm:p-6 backdrop-blur-sm">
      <div className="flex h-[720px] w-[1040px] max-w-full overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950 text-zinc-100 shadow-2xl">
        {/* Sidebar */}
        <div className="flex w-[210px] shrink-0 flex-col border-r border-zinc-800/60 bg-zinc-950 p-2.5">
          {/* Header Label */}
          <div className="px-3 py-2.5">
            <span className="text-[13px] font-semibold tracking-tight text-zinc-200">Settings</span>
          </div>

          {/* Navigation Groups */}
          <div className="mt-1 flex flex-1 flex-col gap-4 overflow-y-auto pr-0.5">
            {/* Group 1: Models & Intelligence */}
            <div>
              <span className="block px-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500">
                Models & Compute
              </span>
              <div className="mt-1 flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => setTab("models")}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                    tab === "models"
                      ? "bg-zinc-800/90 text-zinc-100 font-semibold"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  }`}
                >
                  <span className="grid h-4 w-4 place-items-center shrink-0">
                    <BrainIcon className="h-4 w-4" />
                  </span>
                  <span>Models & AI</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTab("usage")}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                    tab === "usage"
                      ? "bg-zinc-800/90 text-zinc-100 font-semibold"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  }`}
                >
                  <span className="grid h-4 w-4 place-items-center shrink-0">
                    <ActivityIcon className="h-4 w-4" />
                  </span>
                  <span>Usage & Tokens</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTab("ollama")}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                    tab === "ollama"
                      ? "bg-zinc-800/90 text-zinc-100 font-semibold"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  }`}
                >
                  <span className="grid h-4 w-4 place-items-center shrink-0">
                    <CpuIcon className="h-4 w-4" />
                  </span>
                  <span>Local Ollama</span>
                </button>
              </div>
            </div>

            {/* Group 2: Environment */}
            <div>
              <span className="block px-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500">
                Execution
              </span>
              <div className="mt-1 flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => setTab("plugins")}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                    tab === "plugins"
                      ? "bg-zinc-800/90 text-zinc-100 font-semibold"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  }`}
                >
                  <span className="grid h-4 w-4 place-items-center shrink-0">
                    <PuzzleIcon className="h-4 w-4" />
                  </span>
                  <span>Tools & MCP</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTab("computer")}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                    tab === "computer"
                      ? "bg-zinc-800/90 text-zinc-100 font-semibold"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  }`}
                >
                  <span className="grid h-4 w-4 place-items-center shrink-0">
                    <MonitorIcon className="h-4 w-4" />
                  </span>
                  <span>Sandbox Host</span>
                </button>
              </div>
            </div>

            {/* Group 3: System */}
            <div>
              <span className="block px-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500">
                General
              </span>
              <div className="mt-1 flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => setTab("general")}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                    tab === "general"
                      ? "bg-zinc-800/90 text-zinc-100 font-semibold"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  }`}
                >
                  <span className="grid h-4 w-4 place-items-center shrink-0">
                    <SlidersIcon className="h-4 w-4" />
                  </span>
                  <span>Preferences</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTab("account")}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                    tab === "account"
                      ? "bg-zinc-800/90 text-zinc-100 font-semibold"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  }`}
                >
                  <span className="grid h-4 w-4 place-items-center shrink-0">
                    <ShieldIcon className="h-4 w-4" />
                  </span>
                  <span>Account</span>
                </button>
              </div>
            </div>
          </div>

          {/* Footer Metadata */}
          <div className="border-t border-zinc-800/60 pt-2.5 px-3 text-[11px] text-zinc-500">
            <p className="font-medium text-zinc-500">CoWork v1.0</p>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex flex-1 flex-col overflow-hidden bg-zinc-900/20">
          {/* Header */}
          <div className="flex h-12 items-center justify-between border-b border-zinc-800/60 px-6">
            <span className="text-[13.5px] font-semibold text-zinc-200">
              {tab === "models" && "Foundation Models & Keys"}
              {tab === "usage" && "Usage & Tokens"}
              {tab === "ollama" && "Local Offline AI (Ollama)"}
              {tab === "plugins" && "Integrations & Tools"}
              {tab === "computer" && "Execution Sandbox"}
              {tab === "general" && "General Preferences"}
              {tab === "account" && "Account & Workspace"}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="grid h-6 w-6 place-items-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
              aria-label="Close"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Body Content */}
          <div className="rk-scroll flex-1 overflow-y-auto p-6">
            {successMsg ? (
              <div className="mb-4 flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
                <CheckIcon className="h-3.5 w-3.5 shrink-0" />
                <span>{successMsg}</span>
              </div>
            ) : null}

            {errorMsg ? (
              <div className="mb-4 flex items-center gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                <span>{errorMsg}</span>
              </div>
            ) : null}

            {tab === "ollama" && ollamaError ? (
              <div className="mb-4 flex items-center gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                <span>{ollamaError}</span>
              </div>
            ) : null}

            {tab === "ollama" && ollamaStatus === "connected" ? (
              <div className="mb-4 flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
                <CheckIcon className="h-3.5 w-3.5 shrink-0" />
                <span>Connected to Ollama ({ollamaModels.length} models available)</span>
              </div>
            ) : null}

            {/* TAB: MODELS */}
            {tab === "models" ? (
              <div className="space-y-6">
                {/* Active Model Selector */}
                <div>
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                    Default Active Model
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {POPULAR_MODELS.map((m) => {
                      const isSelected =
                        defaultModel === m.id || (!defaultModel && m.id.includes("deepseek"));
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => void handleSelectModel(m.id, m.provider)}
                          className={`flex items-center justify-between rounded-lg border p-2.5 text-left transition-all ${
                            isSelected
                              ? "border-emerald-500/50 bg-emerald-950/20 text-zinc-100"
                              : "border-zinc-800/80 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900"
                          }`}
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-[13px]">{m.name}</span>
                              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                                {m.tag}
                              </span>
                            </div>
                            <span className="text-[11px] text-zinc-400 font-mono">
                              {m.provider}
                            </span>
                          </div>
                          {isSelected ? (
                            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xs">
                              <CheckIcon className="h-3 w-3" />
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Major Providers & API Keys */}
                <div className="border-t border-zinc-800/60 pt-5">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-3">
                    Provider API Keys
                  </span>
                  <div className="space-y-2">
                    {MAJOR_PROVIDERS.map((prov) => {
                      const isConnected = hasKeyForProvider(prov.id);
                      const isSaving = savingProvider === prov.id;
                      const inputVal = activeKeyInputs[prov.id] ?? "";

                      return (
                        <div
                          key={prov.id}
                          className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-3 transition-colors hover:border-zinc-700/80"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-semibold text-zinc-200">
                                {prov.name}
                              </span>
                              <span
                                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
                                  isConnected
                                    ? "bg-emerald-500/10 text-emerald-400"
                                    : "bg-zinc-800 text-zinc-400"
                                }`}
                              >
                                {isConnected ? "● Connected" : "Not configured"}
                              </span>
                            </div>
                            <span className="text-[11px] text-zinc-400">{prov.hint}</span>
                          </div>

                          <div className="flex gap-2">
                            <input
                              type="password"
                              value={inputVal}
                              onChange={(e) =>
                                setActiveKeyInputs((prev) => ({
                                  ...prev,
                                  [prov.id]: e.target.value,
                                }))
                              }
                              placeholder={
                                isConnected ? "•••••••••••••••• (Connected)" : prov.placeholder
                              }
                              className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none placeholder:text-zinc-400 focus:border-zinc-600"
                            />
                            <Button
                              type="button"
                              size="sm"
                              disabled={isSaving || !inputVal.trim()}
                              onClick={() => void handleSaveProviderKey(prov.id)}
                              className="rounded-md text-xs"
                            >
                              {isSaving ? "Saving…" : "Save Key"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}

            {/* TAB: USAGE & TOKENS */}
            {tab === "usage" ? (
              <div className="space-y-5">
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10.5px] font-medium text-zinc-400 uppercase tracking-wider">
                        Total Tokens
                      </span>
                      <ActivityIcon className="h-3.5 w-3.5 text-zinc-500" />
                    </div>
                    <div className="mt-1 text-xl font-bold text-zinc-100 font-mono">
                      {numFormat.format(
                        (usageSummary?.inputTokens ?? 0) + (usageSummary?.outputTokens ?? 0),
                      )}
                    </div>
                    <div className="mt-0.5 text-[10.5px] text-zinc-400">
                      {numFormat.format(usageSummary?.inputTokens ?? 0)} in ·{" "}
                      {numFormat.format(usageSummary?.outputTokens ?? 0)} out
                    </div>
                  </div>

                  <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10.5px] font-medium text-zinc-400 uppercase tracking-wider">
                        Agent Runs
                      </span>
                      <ZapIcon className="h-3.5 w-3.5 text-zinc-500" />
                    </div>
                    <div className="mt-1 text-xl font-bold text-zinc-100 font-mono">
                      {usageSummary?.runs ?? 0}
                    </div>
                    <div className="mt-0.5 text-[10.5px] text-zinc-400">Total completed runs</div>
                  </div>

                  <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10.5px] font-medium text-zinc-400 uppercase tracking-wider">
                        Active Model
                      </span>
                      <BrainIcon className="h-3.5 w-3.5 text-emerald-400" />
                    </div>
                    <div className="mt-1 truncate text-[13px] font-semibold text-zinc-100">
                      {defaultModel || "Default"}
                    </div>
                    <div className="mt-0.5 text-[10.5px] text-zinc-400 font-mono">
                      {defaultProvider || "ollama"}
                    </div>
                  </div>
                </div>

                {/* Runs Activity Log Table */}
                <div>
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                    Recent Activity ({usageList.length})
                  </span>
                  {usageList.length === 0 ? (
                    <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/20 p-6 text-center text-xs text-zinc-400">
                      No runs recorded yet. Start a conversation with your coworker to generate
                      activity.
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-900/30">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-zinc-800 bg-zinc-900/80 text-zinc-400">
                            <th className="py-2 px-3 font-medium">Model</th>
                            <th className="py-2 px-3 font-medium">Input Tokens</th>
                            <th className="py-2 px-3 font-medium">Output Tokens</th>
                            <th className="py-2 px-3 font-medium">Total</th>
                            <th className="py-2 px-3 font-medium">Date</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/40">
                          {usageList.slice(0, 15).map((row) => (
                            <tr key={row.id} className="hover:bg-zinc-800/30 transition-colors">
                              <td className="py-2 px-3 font-medium text-zinc-200">
                                <div>{row.model}</div>
                                <span className="text-[10px] text-zinc-400">{row.provider}</span>
                              </td>
                              <td className="py-2 px-3 text-zinc-400 font-mono">
                                {numFormat.format(row.inputTokens)}
                              </td>
                              <td className="py-2 px-3 text-zinc-400 font-mono">
                                {numFormat.format(row.outputTokens)}
                              </td>
                              <td className="py-2 px-3 font-semibold text-zinc-200 font-mono">
                                {numFormat.format(row.inputTokens + row.outputTokens)}
                              </td>
                              <td className="py-2 px-3 text-zinc-400">
                                {new Date(row.createdAt).toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {/* TAB: OLLAMA */}
            {tab === "ollama" ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-4">
                  <h3 className="text-[13.5px] font-semibold text-zinc-100">
                    Local Offline Models (Ollama)
                  </h3>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Run local open models (DeepSeek-R1, Llama 3.3, Qwen 2.5) on your machine with 0
                    API keys.
                  </p>

                  <div className="mt-3">
                    <label className="block text-xs text-zinc-400">
                      Ollama Endpoint URL
                      <div className="mt-1 flex gap-2">
                        <input
                          value={ollamaUrl}
                          onChange={(e) => setOllamaUrl(e.target.value)}
                          placeholder="http://127.0.0.1:11434"
                          className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none"
                        />
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void checkOllamaConnection()}
                          disabled={ollamaStatus === "checking"}
                          className="rounded-md text-xs"
                        >
                          {ollamaStatus === "checking" ? "Checking…" : "Test Connection"}
                        </Button>
                      </div>
                    </label>
                  </div>

                  {ollamaStatus === "connected" && ollamaModels.length > 0 ? (
                    <div className="mt-4 border-t border-zinc-800/80 pt-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="flex items-center gap-1 text-xs font-medium text-emerald-400">
                          <CheckIcon className="h-3.5 w-3.5" />
                          <span>Discovered Models ({ollamaModels.length})</span>
                        </span>
                        <span className="text-[11px] text-zinc-500">
                          Click to activate as default model
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {ollamaModels.map((m) => {
                          const isSelected =
                            defaultProvider === "ollama" &&
                            (defaultModel === m || defaultModel === `ollama:${m}`);
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => void handleSelectModel(m, "ollama")}
                              className={`flex items-center justify-between rounded-lg border p-2.5 text-left transition-all ${
                                isSelected
                                  ? "border-emerald-500/50 bg-emerald-950/20 text-zinc-100"
                                  : "border-zinc-800/80 bg-zinc-950 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900"
                              }`}
                            >
                              <div>
                                <span className="font-mono text-xs font-semibold text-zinc-200">
                                  {m}
                                </span>
                                <span className="block text-[10.5px] text-zinc-500">
                                  Local Ollama
                                </span>
                              </div>
                              {isSelected ? (
                                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xs">
                                  <CheckIcon className="h-3 w-3" />
                                </span>
                              ) : (
                                <span className="text-[11px] text-zinc-500 hover:text-zinc-200">
                                  Use →
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* TAB: PLUGINS & MCP */}
            {tab === "plugins" ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-4">
                  <h3 className="text-[13.5px] font-semibold text-zinc-100">
                    Model Context Protocol & Tools
                  </h3>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Connect external SaaS apps via Composio or custom MCP endpoints.
                  </p>
                  <p className="mt-2 text-xs text-zinc-400">
                    Set{" "}
                    <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
                      COMPOSIO_API_KEY
                    </code>{" "}
                    in your environment to activate GitHub, Slack, Gmail, Linear, and Notion.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-3">
                    <div className="flex items-center gap-2">
                      <MonitorIcon className="h-4 w-4 text-emerald-400" />
                      <span className="text-[13px] font-medium text-zinc-200">
                        Virtual Desktop Computer
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-400">
                      Live Debian X11 desktop with Chromium.
                    </p>
                  </div>

                  <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-3">
                    <div className="flex items-center gap-2">
                      <TerminalIcon className="h-4 w-4 text-emerald-400" />
                      <span className="text-[13px] font-medium text-zinc-200">
                        Bash Shell Runner
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-400">
                      CLI commands, file edits, test runners.
                    </p>
                  </div>

                  <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-3">
                    <div className="flex items-center gap-2">
                      <ClockIcon className="h-4 w-4 text-emerald-400" />
                      <span className="text-[13px] font-medium text-zinc-200">
                        Scheduled Routines
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-400">
                      Automated background cron tasks.
                    </p>
                  </div>

                  <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-3">
                    <div className="flex items-center gap-2">
                      <FileTextIcon className="h-4 w-4 text-emerald-400" />
                      <span className="text-[13px] font-medium text-zinc-200">Markdown Memory</span>
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-400">
                      Persistent instructions and context.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {/* TAB: COMPUTER & SANDBOX */}
            {tab === "computer" ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-4">
                  <h3 className="text-[13.5px] font-semibold text-zinc-100">Execution Sandbox</h3>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Configure where your coworker executes shell code and browser automation.
                  </p>

                  <div className="mt-3 grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await rpc.deployment.update({ computerHost: "docker" });
                          setDeployment((d) => ({ ...d, computerHost: "docker" }));
                          setSuccessMsg("Switched to Isolated Docker Sandbox.");
                          setErrorMsg(null);
                        } catch (err) {
                          setErrorMsg(
                            err instanceof Error ? err.message : "Could not change sandbox host",
                          );
                        }
                      }}
                      className={`rounded-lg border p-3 text-left transition-all ${
                        deployment?.computerHost !== "this-mac"
                          ? "border-emerald-500/50 bg-emerald-950/20 text-zinc-100"
                          : "border-zinc-800/80 bg-zinc-950 text-zinc-400 hover:border-zinc-700"
                      }`}
                    >
                      <div className="flex items-center justify-between font-semibold text-[13px]">
                        <span>Docker Container (Isolated)</span>
                        {deployment?.computerHost !== "this-mac" ? (
                          <CheckIcon className="h-3.5 w-3.5 text-emerald-400" />
                        ) : null}
                      </div>
                      <p className="mt-1 text-[11.5px] text-zinc-400">
                        Sandboxed Linux container with isolated storage in `/home/cowork`.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await rpc.deployment.update({ computerHost: "this-mac" });
                          setDeployment((d) => ({ ...d, computerHost: "this-mac" }));
                          setSuccessMsg("Switched to This Mac (Host Mode).");
                          setErrorMsg(null);
                        } catch (err) {
                          setErrorMsg(
                            err instanceof Error ? err.message : "Could not change sandbox host",
                          );
                        }
                      }}
                      className={`rounded-lg border p-3 text-left transition-all ${
                        deployment?.computerHost === "this-mac"
                          ? "border-emerald-500/50 bg-emerald-950/20 text-zinc-100"
                          : "border-zinc-800/80 bg-zinc-950 text-zinc-400 hover:border-zinc-700"
                      }`}
                    >
                      <div className="flex items-center justify-between font-semibold text-[13px]">
                        <span>This Mac (Host Mode)</span>
                        {deployment?.computerHost === "this-mac" ? (
                          <CheckIcon className="h-3.5 w-3.5 text-emerald-400" />
                        ) : null}
                      </div>
                      <p className="mt-1 text-[11.5px] text-zinc-400">
                        Executes shell commands directly on your local system.
                      </p>
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {/* TAB: GENERAL */}
            {tab === "general" ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-4">
                  <h3 className="text-[13.5px] font-semibold text-zinc-100">Preferences</h3>
                  <div className="mt-3 space-y-3">
                    <div className="flex items-center justify-between gap-4 border-b border-zinc-800/60 pb-2.5">
                      <div className="min-w-0">
                        <span className="text-xs font-medium text-zinc-200">Completion Chime</span>
                        <p className="text-[11px] text-zinc-400">
                          Play audio when long tasks finish.
                        </p>
                      </div>
                      <Switch
                        checked={soundEnabled}
                        aria-label="Completion chime"
                        onCheckedChange={(next) => {
                          setSoundEnabled(next);
                          savePrefs({ soundEnabled: next });
                          if (next) playCompletionChime();
                        }}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <span className="text-xs font-medium text-zinc-200">Stream Pacing</span>
                        <p className="text-[11px] text-zinc-400">Token streaming animation pace.</p>
                      </div>
                      <div className="flex shrink-0 rounded-md bg-zinc-950 p-0.5 border border-zinc-800">
                        <button
                          type="button"
                          aria-pressed={streamSpeed === "normal"}
                          onClick={() => {
                            setStreamSpeed("normal");
                            savePrefs({ streamSpeed: "normal" });
                          }}
                          className={`cursor-pointer rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                            streamSpeed === "normal"
                              ? "bg-zinc-100 text-zinc-950"
                              : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                          }`}
                        >
                          Smooth
                        </button>
                        <button
                          type="button"
                          aria-pressed={streamSpeed === "fast"}
                          onClick={() => {
                            setStreamSpeed("fast");
                            savePrefs({ streamSpeed: "fast" });
                          }}
                          className={`cursor-pointer rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                            streamSpeed === "fast"
                              ? "bg-zinc-100 text-zinc-950"
                              : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                          }`}
                        >
                          Turbo
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {/* TAB: ACCOUNT */}
            {tab === "account" ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-4">
                  <h3 className="text-[13.5px] font-semibold text-zinc-100">Profile & Workspace</h3>
                  <div className="mt-3 space-y-2 text-xs">
                    <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2">
                      <span className="text-zinc-400">Name</span>
                      <span className="font-medium text-zinc-200">{me?.name || "—"}</span>
                    </div>
                    <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2">
                      <span className="text-zinc-400">Email</span>
                      <span className="font-medium text-zinc-200">{me?.email || "—"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400">Workspace ID</span>
                      <span className="font-mono text-zinc-400">
                        {me?.workspaceId || "default"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
