import { useEffect, useState } from "react";
import { MonitorIcon } from "../components/icons.js";
import { desktopBridge } from "../lib/desktop.js";
import { rpc } from "../lib/rpc.js";

export function HostComputerPrompt() {
  const desktop = desktopBridge();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mac = desktop?.platform === "darwin";
  const hostLabel = mac ? "This Mac" : "This computer";

  useEffect(() => {
    if (!desktop) return;
    void rpc
      .me()
      .then((me) => {
        if (me.canChooseHostComputer && me.computerHost == null) setOpen(true);
      })
      .catch(() => undefined);
  }, [desktop]);

  if (!open) return null;

  async function choose(computerHost: "docker" | "this-mac") {
    setPending(true);
    setError(null);
    try {
      await rpc.deployment.update({ computerHost });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that choice");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm">
      <div className="w-[460px] rounded-xl border border-zinc-800/80 bg-zinc-950 p-6 text-zinc-100 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-zinc-900 border border-zinc-800 text-emerald-400">
            <MonitorIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Where should bots execute?</h2>
            <p className="text-xs text-zinc-400">Choose your execution sandbox</p>
          </div>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-zinc-400">
          <strong className="text-zinc-200">Docker Container (Isolated):</strong> Each coworker runs
          inside an isolated Linux container with a virtual display and desktop browser.
        </p>

        {error ? (
          <div className="mt-3 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => void choose("docker")}
            className="rounded-lg bg-zinc-100 px-4 py-2.5 text-xs font-semibold text-zinc-950 hover:bg-white transition-colors disabled:opacity-50"
          >
            Docker Sandbox (Recommended)
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => void choose("this-mac")}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            Run on {hostLabel} (Host Mode)
          </button>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
          Host mode allows the agent to execute shell commands directly on your local system with
          your active account.
        </p>
      </div>
    </div>
  );
}
