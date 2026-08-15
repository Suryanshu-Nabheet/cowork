import type { ConnectionCatalogItem } from "@cowork/contracts";
import { Button } from "@cowork/ui-web";
import { useEffect, useMemo, useState } from "react";
import { CheckIcon, CloseIcon, PuzzleIcon, SearchIcon, SparklesIcon } from "../components/icons.js";
import { rpc } from "../lib/rpc.js";

let cachedCatalog: ConnectionCatalogItem[] = [];

function markConnected(items: ConnectionCatalogItem[], slug: string, connected: boolean) {
  return items.map((entry) => (entry.slug === slug ? { ...entry, connected } : entry));
}

export function PluginsOverlay({
  onClose,
  onOpenSettings,
}: {
  onClose: () => void;
  onOpenSettings?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<ConnectionCatalogItem[]>(cachedCatalog);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(cachedCatalog.length === 0);

  async function refresh() {
    const items = await rpc.connections.catalog({});
    cachedCatalog = items;
    setCatalog(items);
    return items;
  }

  useEffect(() => {
    void refresh()
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not load catalog"),
      )
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (item) => item.name.toLowerCase().includes(q) || item.slug.toLowerCase().includes(q),
    );
  }, [catalog, query]);

  async function connect(item: ConnectionCatalogItem) {
    setPending(item.slug);
    setError(null);
    try {
      const res = await rpc.connections.begin({
        provider: item.slug,
        displayName: item.name,
      });
      if (res.authorizationUrl) {
        window.open(res.authorizationUrl, "_blank", "noopener,noreferrer");
      }
      setCatalog((prev) => markConnected(prev, item.slug, true));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setPending(null);
    }
  }

  async function revoke(item: ConnectionCatalogItem) {
    setPending(item.slug);
    setError(null);
    try {
      const rows = await rpc.connections.list();
      const row = rows.find(
        (entry) => entry.provider === item.slug && entry.status === "connected",
      );
      if (row) {
        await rpc.connections.revoke({ connectionId: row.id });
      }
      setCatalog((prev) => markConnected(prev, item.slug, false));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 sm:p-6 backdrop-blur-sm">
      <div className="flex h-[720px] w-[1040px] max-w-full flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950 text-zinc-100 shadow-2xl">
        {/* Header */}
        <div className="flex h-14 items-center justify-between border-b border-zinc-800/60 px-6">
          <div className="flex items-center gap-2.5">
            <PuzzleIcon className="h-4 w-4 text-zinc-400" />
            <h2 className="text-[14px] font-semibold text-zinc-100">Plugins & Integrations</h2>
            <span className="rounded bg-zinc-800/80 px-2 py-0.5 text-[11px] font-medium text-zinc-400">
              {loading ? "Loading…" : `${catalog.length} available apps`}
            </span>
          </div>
          <button
            type="button"
            aria-label="Close plugins"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="border-b border-zinc-800/60 bg-zinc-900/20 px-6 py-3">
          <div className="relative flex items-center">
            <SearchIcon className="absolute left-3.5 h-3.5 w-3.5 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search integrations (GitHub, Slack, Google Calendar, Notion, Gmail, Linear...)"
              className="w-full rounded-lg border border-zinc-800/80 bg-zinc-950 pl-9 pr-4 py-2 text-xs text-zinc-200 outline-none placeholder:text-zinc-500 focus:border-zinc-700"
            />
          </div>
        </div>

        {/* Content Body */}
        <div className="rk-scroll flex-1 overflow-y-auto p-6">
          {error ? (
            <div className="mb-4 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          ) : null}

          {!loading && catalog.length === 0 ? (
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-8 text-center">
              <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-zinc-800 text-zinc-300">
                <PuzzleIcon className="h-5 w-5" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-zinc-200">
                Connect External Tool Catalog
              </h3>
              <p className="mx-auto mt-1.5 max-w-[500px] text-xs text-zinc-400 leading-relaxed">
                To enable 200+ app connectors (Slack, GitHub, Gmail, Linear, Notion, Google Docs),
                configure your{" "}
                <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-200 font-mono">
                  COMPOSIO_API_KEY
                </code>{" "}
                in your environment or settings.
              </p>
              <div className="mt-5 flex justify-center gap-3">
                {onOpenSettings ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      onClose();
                      onOpenSettings();
                    }}
                    className="rounded-md text-xs px-4"
                  >
                    Open Settings & Keys
                  </Button>
                ) : null}
                <a
                  href="https://app.composio.dev"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-4 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 transition-colors inline-flex items-center gap-1.5"
                >
                  <SparklesIcon className="h-3.5 w-3.5 text-zinc-400" />
                  <span>Get Composio Key</span>
                </a>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2.5">
            {visible.map((item) => (
              <div
                key={item.slug}
                className="flex items-center gap-3 rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-3 transition-colors hover:border-zinc-700/80"
              >
                {item.logo ? (
                  <img
                    src={item.logo}
                    alt=""
                    className="h-9 w-9 rounded-lg bg-zinc-800 object-contain p-1"
                  />
                ) : (
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-zinc-800 font-semibold text-xs text-zinc-300">
                    {item.name[0]}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium text-zinc-200 truncate">
                      {item.name}
                    </span>
                    {item.connected ? (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                        <CheckIcon className="h-2.5 w-2.5" />
                        <span>Connected</span>
                      </span>
                    ) : null}
                  </div>
                  <span className="block text-[11px] text-zinc-500 truncate font-mono">
                    {item.slug}
                    {item.noAuth ? " · no auth" : ""}
                  </span>
                </div>
                {item.connected ? (
                  <Button
                    type="button"
                    variant="pill"
                    size="sm"
                    disabled={pending === item.slug}
                    onClick={() => void revoke(item)}
                    className="text-xs text-zinc-400 hover:text-red-400"
                  >
                    {pending === item.slug ? "Revoking…" : "Revoke"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="pill"
                    size="sm"
                    disabled={pending === item.slug}
                    onClick={() => void connect(item)}
                    className="text-xs"
                  >
                    {pending === item.slug ? "Connecting…" : "Connect"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
