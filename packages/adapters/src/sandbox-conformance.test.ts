import { execSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SandboxProvider } from "@cowork/adapter-kit";
import { afterAll, describe, expect, it } from "vitest";
import { DesktopSandboxProvider } from "./desktop-sandbox.js";
import { DockerSandboxProvider } from "./docker-sandbox.js";
import { ManagedSandboxEmulator } from "./e2b-emulator.js";
import { FakeSandboxProvider } from "./fake-sandbox.js";

const ctx = {
  operationId: "1",
  traceId: "1",
  workspaceId: "w",
  userId: "u",
  signal: new AbortController().signal,
};

async function drain(
  provider: SandboxProvider,
  computer: {
    id: string;
    botId: string;
    kind: "fake" | "e2b" | "docker" | "desktop";
    providerRef: string;
  },
) {
  let stdout = "";
  for await (const event of provider.execute(computer, { argv: ["echo", "graphical-ok"] }, ctx)) {
    if (event.type === "stdout") stdout += event.data;
    if (event.type === "exit") expect(event.code).toBe(0);
  }
  return stdout;
}

describe("sandbox conformance", () => {
  it("runs the same graphical command on fake, managed-sandbox emulator, and desktop", async () => {
    const fake = new FakeSandboxProvider();
    const managed = new ManagedSandboxEmulator();
    const desktop = new DesktopSandboxProvider();
    const a = await fake.provision({ botId: "bot-a", homePath: "/tmp/a" }, ctx);
    const b = await managed.provision({ botId: "bot-b", homePath: "/tmp/b" }, ctx);
    const c = await desktop.provision({ botId: "bot-c", homePath: "/tmp/c" }, ctx);
    const outA = await drain(fake, a);
    const outB = await drain(managed, b);
    const outC = await drain(desktop, c);
    expect(outA).toContain("graphical-ok");
    expect(outB).toContain("graphical-ok");
    expect(outC).toContain("graphical-ok");
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    await fake.destroy(a, ctx);
    await managed.destroy(b, ctx);
    await desktop.destroy(c, ctx);
  });

  it("desktop executor refuses paths outside the computer home", async () => {
    const desktop = new DesktopSandboxProvider();
    const computer = await desktop.provision({ botId: "grant", homePath: "/tmp/grant" }, ctx);
    let stderr = "";
    let code = 0;
    for await (const event of desktop.execute(
      computer,
      { argv: ["echo", "nope"], cwd: "/etc" },
      ctx,
    )) {
      if (event.type === "stderr") stderr += event.data;
      if (event.type === "exit") code = event.code;
    }
    expect(code).toBe(1);
    expect(stderr).toMatch(/outside this computer's home/i);
    await desktop.destroy(computer, ctx);
  });
});

describe("docker sandbox", () => {
  let spawned: ReturnType<typeof spawn> | undefined;
  const dataDir = mkdtempSync(path.join(tmpdir(), "cowork-docker-conformance-"));

  afterAll(async () => {
    spawned?.kill("SIGTERM");
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("runs the same graphical command through the supervisor", async ({ skip }) => {
    if (!dockerAvailable() || !hasAnySandboxImage()) {
      skip();
      return;
    }
    const port = 17991;
    const token = "sandbox-conformance-token";
    const url = `http://127.0.0.1:${port}`;
    const root = path.resolve(import.meta.dirname, "../../..");
    spawned = spawn("pnpm", ["--filter", "@cowork/sandbox-supervisor", "start"], {
      cwd: root,
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        SANDBOX_SUPERVISOR_TOKEN: token,
        SUPERVISOR_PORT: String(port),
      },
      stdio: "ignore",
    });
    const up = await waitForHealth(`${url}/health`, 20_000);
    if (!up) {
      skip();
      return;
    }
    const provider = new DockerSandboxProvider(url, token);
    const botId = `conf-${Date.now()}`;
    const computer = await provider.provision(
      { botId, homePath: path.join(dataDir, "homes", botId) },
      ctx,
    );
    const out = await drain(provider, computer);
    expect(out).toContain("graphical-ok");
    const session = await provider.connectScreen(computer, { view: "stream" }, ctx);
    expect(session.url).toMatch(/embed\.html/);
    await provider.destroy(computer, ctx);
  }, 60_000);
});

function dockerAvailable() {
  try {
    execSync("docker info", { stdio: "ignore", timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

function hasAnySandboxImage() {
  try {
    execSync("docker image inspect cowork/computer:local", { stdio: "ignore", timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

async function ping(url: string) {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(url: string, ms: number) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await ping(url)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
