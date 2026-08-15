import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AdapterContext,
  CommandRequest,
  ComputerInput,
  ComputerRef,
  ControlLeaseRef,
  ProcessEvent,
  SandboxProvider,
  ScreenRequest,
  ScreenSession,
} from "@cowork/adapter-kit";

interface DesktopBox {
  ref: ComputerRef;
  home: string;
  running: boolean;
  screen: string;
}

export class DesktopSandboxProvider implements SandboxProvider {
  readonly boxes = new Map<string, DesktopBox>();

  constructor(private readonly opts: { root?: string; hostRoots?: string[] } = {}) {}

  describe() {
    return {
      id: "desktop",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: {
        graphical: true,
        pty: true,
        snapshots: true,
        takeover: true,
        persistentHome: true,
      },
    };
  }

  async provision(
    request: { botId: string; homePath: string },
    _context: AdapterContext,
  ): Promise<ComputerRef> {
    const id = `desktop-${request.botId}-${randomUUID().slice(0, 8)}`;
    const home = path.resolve(
      this.opts.root ?? path.join(process.cwd(), "data"),
      "desktop-computers",
      request.botId,
    );
    await mkdir(home, { recursive: true });
    const ref: ComputerRef = { id, botId: request.botId, kind: "desktop", providerRef: home };
    this.boxes.set(id, {
      ref,
      home,
      running: true,
      screen: "ready",
    });
    return ref;
  }

  async *execute(
    computer: ComputerRef,
    request: CommandRequest,
    _context: AdapterContext,
  ): AsyncIterable<ProcessEvent> {
    const box = this.boxFor(computer);
    if (!box) {
      yield { type: "stderr", data: "computer not found" };
      yield { type: "exit", code: 1 };
      return;
    }
    const cwd = resolveExecuteCwd(request.cwd, box.home);
    if (!allowedPath(cwd, this.allowedRoots(box.home))) {
      yield { type: "stderr", data: "path is outside this computer's home" };
      yield { type: "exit", code: 1 };
      return;
    }
    await mkdir(cwd, { recursive: true });
    const argv = request.argv.length ? request.argv : ["echo", "ready"];
    const result = await runCommand(argv, cwd);
    if (result.stdout) yield { type: "stdout", data: result.stdout };
    if (result.stderr) yield { type: "stderr", data: result.stderr };
    yield { type: "exit", code: result.code };
  }

  async connectScreen(
    computer: ComputerRef,
    _request: ScreenRequest,
    _context: AdapterContext,
  ): Promise<ScreenSession> {
    return {
      url: `desktop://screen/${computer.id}`,
      mimeType: "text/plain",
      close: async () => undefined,
    };
  }

  async sendInput(
    computer: ComputerRef,
    input: ComputerInput,
    _lease: ControlLeaseRef,
    _context: AdapterContext,
  ): Promise<void> {
    const box = this.boxFor(computer);
    if (box && input.kind === "clipboard") box.screen = input.text;
  }

  async snapshot(computer: ComputerRef, _context: AdapterContext) {
    return { id: `desktop-snap-${computer.id}`, createdAt: new Date().toISOString() };
  }

  async stop(computer: ComputerRef, _context: AdapterContext): Promise<void> {
    const box = this.boxFor(computer);
    if (box) box.running = false;
  }

  async destroy(computer: ComputerRef, _context: AdapterContext): Promise<void> {
    const box = this.boxFor(computer);
    if (box) this.boxes.delete(box.ref.id);
    this.boxes.delete(computer.id);
    if (box && this.opts.root) {
      await writeFile(path.join(box.home, ".stopped"), new Date().toISOString(), "utf8").catch(
        () => undefined,
      );
    }
    if (box && !this.opts.root) {
      await rm(box.home, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private boxFor(computer: ComputerRef): DesktopBox | undefined {
    const existing = this.boxes.get(computer.id);
    if (existing) return existing;
    for (const box of this.boxes.values()) {
      if (box.ref.botId === computer.botId || box.home === computer.providerRef) return box;
    }
    if (!computer.providerRef) return undefined;
    const box: DesktopBox = {
      ref: computer,
      home: path.resolve(computer.providerRef),
      running: true,
      screen: "ready",
    };
    this.boxes.set(computer.id, box);
    return box;
  }

  private allowedRoots(home: string) {
    return [home, ...(this.opts.hostRoots ?? [])];
  }
}

function resolveExecuteCwd(requestCwd: string | undefined, home: string) {
  if (!requestCwd || requestCwd === "/home/cowork" || requestCwd === "/home/user") return home;
  return path.resolve(home, requestCwd);
}

function allowedPath(target: string, roots: string[]) {
  const resolved = path.resolve(target);
  return roots.some((root) => {
    const base = path.resolve(root);
    return resolved === base || resolved.startsWith(base + path.sep);
  });
}

function runCommand(
  argv: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (argv[0] === "echo") {
        resolve({ stdout: `${argv.slice(1).join(" ")}\n`, stderr: "", code: 0 });
        return;
      }
      resolve({ stdout: "", stderr: error.message, code: 1 });
    });
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}
