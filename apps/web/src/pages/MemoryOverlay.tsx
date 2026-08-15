import type { MemoryDocument } from "@cowork/contracts";
import { Button } from "@cowork/ui-web";
import { useEffect, useMemo, useState } from "react";
import { CloseIcon, FileTextIcon, SearchIcon } from "../components/icons.js";
import { rpc } from "../lib/rpc.js";

export function MemoryOverlay({ botId, onClose }: { botId: string; onClose: () => void }) {
  const [docs, setDocs] = useState<MemoryDocument[]>([]);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const rows = await rpc.memory.list({ botId });
    const user = await rpc.memory.list({ scope: "user" }).catch(() => [] as MemoryDocument[]);
    const merged = [...rows, ...user.filter((doc) => !rows.some((row) => row.id === doc.id))];
    setDocs(merged);
    return merged;
  }

  useEffect(() => {
    void refresh()
      .then((rows) => {
        const first = rows[0];
        if (first) {
          setActiveId(first.id);
          setDraft(first.content);
        }
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not load memory"),
      )
      .finally(() => setLoading(false));
  }, [botId]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter(
      (doc) =>
        doc.path.toLowerCase().includes(q) ||
        doc.content.toLowerCase().includes(q) ||
        doc.scope.toLowerCase().includes(q),
    );
  }, [docs, query]);

  const active = docs.find((doc) => doc.id === activeId) ?? null;

  async function save() {
    if (!active) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await rpc.memory.update({ documentId: active.id, content: draft });
      setDocs((prev) => prev.map((doc) => (doc.id === updated.id ? updated : doc)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save memory");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="flex h-[min(720px,90vh)] w-[min(920px,96vw)] overflow-hidden rounded-2xl border border-[#232326] bg-[#111114] shadow-[0_40px_80px_rgba(0,0,0,.55)]">
        <aside className="flex w-[280px] shrink-0 flex-col border-r border-[#1D1D20]">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2 text-[#ECECEE]">
              <FileTextIcon className="h-4 w-4" />
              <span className="text-[14px] font-medium">Memory</span>
            </div>
            <button type="button" onClick={onClose} className="text-[#85858A] hover:text-[#ECECEE]">
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="px-3 pb-3">
            <div className="flex items-center gap-2 rounded-lg border border-[#26262A] bg-[#0C0C0E] px-2.5 py-1.5 text-[#85858A]">
              <SearchIcon className="h-3.5 w-3.5" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search notes"
                className="w-full bg-transparent text-[13px] text-[#ECECEE] outline-none"
              />
            </div>
          </div>
          <div className="rk-scroll flex-1 overflow-y-auto px-2 pb-3">
            {loading ? <p className="px-2 text-[13px] text-[#85858A]">Loading…</p> : null}
            {!loading && visible.length === 0 ? (
              <p className="px-2 text-[13px] text-[#85858A]">No memory documents yet.</p>
            ) : null}
            {visible.map((doc) => (
              <button
                key={doc.id}
                type="button"
                onClick={() => {
                  setActiveId(doc.id);
                  setDraft(doc.content);
                }}
                className={`mb-1 w-full rounded-xl px-3 py-2.5 text-left ${
                  doc.id === activeId ? "bg-[#1A1A1D]" : "hover:bg-[#161618]"
                }`}
              >
                <div className="truncate text-[13.5px] text-[#ECECEE]">{doc.path}</div>
                <div className="mt-0.5 text-[11.5px] uppercase tracking-wide text-[#6C6C70]">
                  {doc.scope} · r{doc.revision}
                </div>
              </button>
            ))}
          </div>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-[#1D1D20] px-5 py-3">
            <div>
              <div className="text-[15px] text-[#ECECEE]">
                {active?.path ?? "Select a document"}
              </div>
              {active ? (
                <div className="text-[12px] text-[#6C6C70]">
                  {active.scope} memory · revision {active.revision}
                </div>
              ) : null}
            </div>
            <Button
              type="button"
              disabled={!active || saving}
              onClick={() => void save()}
              className="rounded-[10px] bg-[#F1F1EF] px-3.5 py-1.5 text-[13px] text-[#17171A] disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
          {error ? <p className="px-5 pt-3 text-[13px] text-[#E65707]">{error}</p> : null}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!active}
            placeholder="Markdown memory for this bot and your user notes."
            className="h-full w-full flex-1 resize-none bg-transparent px-5 py-4 font-mono text-[13.5px] leading-relaxed text-[#DFDFE2] outline-none disabled:opacity-50"
          />
        </section>
      </div>
    </div>
  );
}
