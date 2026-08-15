import { homedir } from "node:os";
import type {
  AdapterContext,
  CommandRequest,
  ComputerInput,
  ComputerRef,
  ControlLeaseRef,
  ProcessEvent,
  SandboxProvider,
  ScreenRequest,
} from "@cowork/adapter-kit";
import type { PrismaClient } from "@cowork/db";
import { DesktopSandboxProvider } from "./desktop-sandbox.js";
import { createSandboxProvider } from "./sandbox-factory.js";

export function sandboxKindForBot(envKind: string, computerHost: string | null | undefined) {
  if (envKind === "docker" && computerHost === "this-mac") return "desktop";
  return envKind;
}

export function createRunSandbox(
  kind: string,
  opts: {
    supervisorUrl?: string;
    supervisorToken?: string;
    e2bApiKey?: string;
    dataDir?: string;
    prisma?: PrismaClient;
  },
): SandboxProvider {
  if (kind === "desktop") {
    return new DesktopSandboxProvider({
      root: opts.dataDir,
      hostRoots: [homedir()],
    });
  }
  const primary = createSandboxProvider(kind, opts);
  if (kind !== "docker" || !opts.prisma) return primary;
  return new HostAwareSandbox(
    primary,
    new DesktopSandboxProvider({
      root: opts.dataDir,
      hostRoots: [homedir()],
    }),
    async () => {
      const settings = await opts.prisma!.deploymentSettings.findUnique({
        where: { id: "default" },
      });
      return settings?.computerHost === "this-mac";
    },
  );
}

export class HostAwareSandbox implements SandboxProvider {
  constructor(
    private readonly isolated: SandboxProvider,
    private readonly host: SandboxProvider,
    private readonly hostEnabled: () => Promise<boolean>,
  ) {}

  describe() {
    return this.isolated.describe();
  }

  private route(computer: ComputerRef) {
    return computer.kind === "desktop" ? this.host : this.isolated;
  }

  async provision(
    request: { botId: string; homePath: string; providerRef?: string },
    context: AdapterContext,
  ) {
    const provider = (await this.hostEnabled()) ? this.host : this.isolated;
    return provider.provision(request, context);
  }

  async *execute(
    computer: ComputerRef,
    request: CommandRequest,
    context: AdapterContext,
  ): AsyncIterable<ProcessEvent> {
    yield* this.route(computer).execute(computer, request, context);
  }

  connectScreen(computer: ComputerRef, request: ScreenRequest, context: AdapterContext) {
    return this.route(computer).connectScreen(computer, request, context);
  }

  sendInput(
    computer: ComputerRef,
    input: ComputerInput,
    lease: ControlLeaseRef,
    context: AdapterContext,
  ) {
    return this.route(computer).sendInput(computer, input, lease, context);
  }

  snapshot(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).snapshot(computer, context);
  }

  stop(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).stop(computer, context);
  }

  destroy(computer: ComputerRef, context: AdapterContext) {
    return this.route(computer).destroy(computer, context);
  }
}
