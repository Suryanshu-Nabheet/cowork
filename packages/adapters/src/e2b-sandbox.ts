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
import { Sandbox } from "@e2b/desktop";
import { sandboxIdleMs } from "./computer-idle.js";

export function e2bCreateOptions(botId: string, apiKey: string) {
  return {
    apiKey,
    timeoutMs: sandboxIdleMs(),
    metadata: { botId, cowork: "computer" },
    resolution: [1280, 800] as [number, number],
    lifecycle: { onTimeout: "pause" as const, autoResume: false },
  };
}

export function isUnrecoverableSandboxError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|does not exist|404|not_found|killed|doesn't exist|sandbox not found/i.test(
    message,
  );
}

export const E2B_BROWSER_APPS = ["google-chrome", "firefox", "chromium"] as const;

export async function openDesktopBrowser(desktop: {
  launch: (application: string, uri?: string) => Promise<void>;
  open: (fileOrUrl: string) => Promise<void>;
}): Promise<void> {
  for (const app of E2B_BROWSER_APPS) {
    try {
      await desktop.launch(app);
      return;
    } catch {
      // try the next installed browser
    }
  }
  await desktop.open("https://www.google.com").catch(() => undefined);
}

export class E2BSandboxProvider implements SandboxProvider {
  private readonly boxes = new Map<string, Sandbox>();

  constructor(private readonly apiKey: string) {}

  describe() {
    return {
      id: "e2b",
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

  private async box(computer: ComputerRef): Promise<Sandbox> {
    const id = computer.providerRef || computer.id;
    const existing = this.boxes.get(id);
    if (existing) {
      await existing.setTimeout(sandboxIdleMs()).catch(() => undefined);
      return existing;
    }
    const connected = await Sandbox.connect(id, {
      apiKey: this.apiKey,
      timeoutMs: sandboxIdleMs(),
    });
    await this.startStream(connected);
    this.boxes.set(connected.sandboxId, connected);
    return connected;
  }

  private async startStream(desktop: Sandbox) {
    await desktop.stream.start({ requireAuth: true }).catch(() => desktop.stream.start());
  }

  async provision(
    request: { botId: string; homePath: string; providerRef?: string },
    _context: AdapterContext,
  ): Promise<ComputerRef> {
    if (request.providerRef) {
      try {
        const desktop = await Sandbox.connect(request.providerRef, {
          apiKey: this.apiKey,
          timeoutMs: sandboxIdleMs(),
        });
        await this.startStream(desktop);
        this.boxes.set(desktop.sandboxId, desktop);
        return {
          id: desktop.sandboxId,
          botId: request.botId,
          kind: "e2b",
          providerRef: desktop.sandboxId,
        };
      } catch (error) {
        this.boxes.delete(request.providerRef);
        if (!isUnrecoverableSandboxError(error)) throw error;
      }
    }
    const desktop = await Sandbox.create(e2bCreateOptions(request.botId, this.apiKey));
    await desktop.files.makeDir("/home/user/cowork-home").catch(() => undefined);
    await this.startStream(desktop);
    await openDesktopBrowser(desktop);
    this.boxes.set(desktop.sandboxId, desktop);
    return {
      id: desktop.sandboxId,
      botId: request.botId,
      kind: "e2b",
      providerRef: desktop.sandboxId,
    };
  }

  async *execute(
    computer: ComputerRef,
    request: CommandRequest,
    _context: AdapterContext,
  ): AsyncIterable<ProcessEvent> {
    const desktop = await this.box(computer);
    const cmd = request.argv.join(" ");
    const result = await desktop.commands.run(cmd, { cwd: request.cwd ?? "/home/user" });
    if (result.stdout) yield { type: "stdout", data: result.stdout };
    if (result.stderr) yield { type: "stderr", data: result.stderr };
    yield { type: "exit", code: result.exitCode ?? 0 };
  }

  async connectScreen(
    computer: ComputerRef,
    _request: ScreenRequest,
    _context: AdapterContext,
  ): Promise<ScreenSession> {
    const desktop = await this.box(computer);
    let authKey: string | undefined;
    try {
      authKey = desktop.stream.getAuthKey();
    } catch {
      authKey = undefined;
    }
    const url =
      typeof desktop.stream.getUrl === "function"
        ? desktop.stream.getUrl({
            autoConnect: true,
            resize: "scale",
            ...(authKey ? { authKey } : {}),
          })
        : null;
    return {
      url,
      mimeType: "text/html",
      close: async () => {
        await desktop.stream.stop().catch(() => undefined);
      },
    };
  }

  async sendInput(
    computer: ComputerRef,
    input: ComputerInput,
    _lease: ControlLeaseRef,
    _context: AdapterContext,
  ): Promise<void> {
    const desktop = await this.box(computer);
    if (input.kind === "key") {
      await desktop.press(input.key);
    } else if (input.kind === "pointer") {
      if (input.type === "move") await desktop.moveMouse(input.x, input.y);
      else if (input.type === "click" || input.type === "down") {
        if (input.button === "right") await desktop.rightClick(input.x, input.y);
        else await desktop.leftClick(input.x, input.y);
      }
    } else if (input.kind === "clipboard") {
      await desktop.write(input.text);
    }
  }

  async snapshot(computer: ComputerRef, _context: AdapterContext) {
    const desktop = await this.box(computer);
    await desktop.screenshot().catch(() => undefined);
    return { id: `e2b-${computer.id}-${Date.now()}`, createdAt: new Date().toISOString() };
  }

  async keepAlive(computer: ComputerRef): Promise<void> {
    await this.box(computer);
  }

  async stop(computer: ComputerRef, _context: AdapterContext): Promise<void> {
    const id = computer.providerRef || computer.id;
    const desktop = this.boxes.get(id);
    this.boxes.delete(id);
    if (desktop) {
      await desktop.pause().catch(() => undefined);
      return;
    }
    await Sandbox.pause(id, { apiKey: this.apiKey }).catch(() => undefined);
  }

  async destroy(computer: ComputerRef, _context: AdapterContext): Promise<void> {
    const desktop = await this.box(computer).catch(() => undefined);
    await desktop?.kill();
    this.boxes.delete(computer.providerRef || computer.id);
  }
}
