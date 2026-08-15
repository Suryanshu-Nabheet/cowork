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
import { resolveSupervisorToken } from "@cowork/core";

export class DockerSandboxProvider implements SandboxProvider {
  private readonly supervisorToken: string;

  constructor(
    private readonly supervisorUrl: string,
    supervisorToken?: string,
  ) {
    this.supervisorToken = supervisorToken ?? resolveSupervisorToken(process.env);
  }

  describe() {
    return {
      id: "docker",
      contractVersion: "1",
      adapterVersion: "1.0.0",
      capabilities: {
        graphical: true,
        pty: true,
        snapshots: true,
        takeover: true,
        persistentHome: true,
      },
    };
  }

  private url(path: string) {
    return `${this.supervisorUrl.replace(/\/$/, "")}${path}`;
  }

  private headers(context: AdapterContext, botId?: string) {
    return {
      authorization: `Bearer ${this.supervisorToken}`,
      "x-cowork-workspace-id": context.workspaceId,
      ...(botId ? { "x-cowork-bot-id": botId } : {}),
    };
  }

  async provision(
    request: { botId: string; homePath: string },
    context: AdapterContext,
  ): Promise<ComputerRef> {
    const res = await fetch(this.url("/computers"), {
      method: "POST",
      headers: { ...this.headers(context, request.botId), "content-type": "application/json" },
      body: JSON.stringify({
        botId: request.botId,
        homePath: request.homePath,
        workspaceId: context.workspaceId,
      }),
      signal: context.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`sandbox provision failed: ${res.status} ${detail}`.trim());
    }
    const body = (await res.json()) as { id: string };
    return { id: body.id, botId: request.botId, kind: "docker", providerRef: body.id };
  }

  async *execute(
    computer: ComputerRef,
    request: CommandRequest,
    context: AdapterContext,
  ): AsyncIterable<ProcessEvent> {
    const res = await fetch(this.url(`/computers/${computer.id}/exec`), {
      method: "POST",
      headers: { ...this.headers(context, computer.botId), "content-type": "application/json" },
      body: JSON.stringify({ ...request, cwd: request.cwd ?? "/home/cowork" }),
      signal: context.signal,
    });
    if (!res.ok) {
      yield { type: "stderr", data: `exec failed: ${res.status}` };
      yield { type: "exit", code: 1 };
      return;
    }
    const body = (await res.json()) as { stdout: string; stderr: string; code: number };
    if (body.stdout) yield { type: "stdout", data: body.stdout };
    if (body.stderr) yield { type: "stderr", data: body.stderr };
    yield { type: "exit", code: body.code };
  }

  async connectScreen(
    computer: ComputerRef,
    _request: ScreenRequest,
    context: AdapterContext,
  ): Promise<ScreenSession> {
    const res = await fetch(this.url(`/computers/${computer.id}`), {
      headers: this.headers(context, computer.botId),
      signal: context.signal,
    });
    if (!res.ok) {
      return { url: null, mimeType: "text/html", close: async () => undefined };
    }
    const body = (await res.json()) as { screenUrl?: string };
    return {
      url: body.screenUrl ?? this.url(`/computers/${computer.id}/screen`),
      mimeType: "text/html",
      close: async () => undefined,
    };
  }

  async sendInput(
    computer: ComputerRef,
    input: ComputerInput,
    lease: ControlLeaseRef,
    context: AdapterContext,
  ): Promise<void> {
    const res = await fetch(this.url(`/computers/${computer.id}/input`), {
      method: "POST",
      headers: { ...this.headers(context, computer.botId), "content-type": "application/json" },
      body: JSON.stringify({ input, leaseId: lease.leaseId }),
      signal: context.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`sandbox input failed: ${res.status} ${detail}`.trim());
    }
  }

  async snapshot(computer: ComputerRef, _context: AdapterContext) {
    return { id: `docker-snap-${computer.id}`, createdAt: new Date().toISOString() };
  }

  async stop(computer: ComputerRef, context: AdapterContext): Promise<void> {
    await fetch(this.url(`/computers/${computer.id}/stop`), {
      method: "POST",
      headers: this.headers(context, computer.botId),
      signal: context.signal,
    });
  }

  async destroy(computer: ComputerRef, context: AdapterContext): Promise<void> {
    await fetch(this.url(`/computers/${computer.id}`), {
      method: "DELETE",
      headers: this.headers(context, computer.botId),
      signal: context.signal,
    });
  }
}
