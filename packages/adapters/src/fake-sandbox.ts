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

export interface FakeBox {
  ref: ComputerRef;
  files: Map<string, string>;
  running: boolean;
  screen: string;
}

export class FakeSandboxProvider implements SandboxProvider {
  readonly boxes = new Map<string, FakeBox>();

  describe() {
    return {
      id: "fake",
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
    const id = `fake-${request.botId}`;
    const existing = this.boxes.get(id);
    if (existing) {
      existing.running = true;
      return existing.ref;
    }
    const ref: ComputerRef = {
      id,
      botId: request.botId,
      kind: "fake",
      providerRef: request.homePath,
    };
    this.boxes.set(ref.id, {
      ref,
      files: new Map(),
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
    const box = this.boxes.get(computer.id);
    if (!box) {
      yield { type: "stderr", data: "computer not found" };
      yield { type: "exit", code: 1 };
      return;
    }
    const cmd = request.argv.join(" ");
    if (request.argv[0] === "echo") {
      yield { type: "stdout", data: `${request.argv.slice(1).join(" ")}\n` };
    } else if (cmd.startsWith("cat ")) {
      const file = request.argv[1] ?? "";
      yield { type: "stdout", data: box.files.get(file) ?? "" };
    } else {
      yield { type: "stdout", data: `ran ${cmd}\n` };
    }
    yield { type: "exit", code: 0 };
  }

  async connectScreen(
    computer: ComputerRef,
    _request: ScreenRequest,
    _context: AdapterContext,
  ): Promise<ScreenSession> {
    return {
      url: `fake://screen/${computer.id}`,
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
    const box = this.boxes.get(computer.id);
    if (box && input.kind === "clipboard") box.screen = input.text;
  }

  async snapshot(computer: ComputerRef, _context: AdapterContext) {
    return { id: `snap-${computer.id}`, createdAt: new Date().toISOString() };
  }

  async stop(computer: ComputerRef, _context: AdapterContext): Promise<void> {
    const box = this.boxes.get(computer.id);
    if (box) box.running = false;
  }

  async destroy(computer: ComputerRef, _context: AdapterContext): Promise<void> {
    this.boxes.delete(computer.id);
  }
}
