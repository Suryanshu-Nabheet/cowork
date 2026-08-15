import type { SandboxProvider, WakeupDriver } from "@cowork/adapter-kit";
import { createDb, type PrismaClient } from "@cowork/db";
import { MarkdownMemoryStore } from "@cowork/memory";
import { createConnectorStack, isComposioEnabled } from "./composio-connector.js";
import { sleepComputerIfIdle } from "./computer-idle.js";
import type { DestinationEmulator } from "./destination-emulator.js";
import { createRunExecutor } from "./executor.js";
import { ExpoPushProvider } from "./expo-push.js";
import { LocalAgentHomeStore } from "./home.js";
import { createRunSandbox } from "./host-aware-sandbox.js";
import { PiOAuthLogins } from "./pi-oauth.js";
import { PiAgentRuntime } from "./pi-runtime.js";
import { ScriptedAgentRuntime } from "./scripted-runtime.js";
import { EncryptedSecretStore } from "./secrets.js";
import { GraphileWakeupDriver, InMemoryWakeupDriver } from "./wakeup.js";

export type RunExecutor = ReturnType<typeof createRunExecutor>;

export interface RuntimeStackConfig {
  databaseUrl: string;
  dataDir: string;
  encryptionKey: string;
  sandboxProvider: string;
  sandboxSupervisorUrl?: string;
  sandboxSupervisorToken?: string;
  e2bApiKey?: string;
  composioApiKey?: string;
  agentRuntime: string;
  wakeupDriver: string;
  openRouterKey?: string;
  prisma?: PrismaClient;
}

export async function createRuntimeStack(config: RuntimeStackConfig) {
  const created = config.prisma
    ? { prisma: config.prisma, pool: undefined }
    : createDb(config.databaseUrl);
  const { prisma } = created;
  created.pool?.on("error", () => undefined);

  const wakeup: WakeupDriver =
    config.wakeupDriver === "memory"
      ? new InMemoryWakeupDriver()
      : new GraphileWakeupDriver(config.databaseUrl);
  const sandbox: SandboxProvider = createRunSandbox(config.sandboxProvider, {
    supervisorUrl: config.sandboxSupervisorUrl,
    supervisorToken: config.sandboxSupervisorToken,
    e2bApiKey: config.e2bApiKey,
    dataDir: config.dataDir,
    prisma,
  });
  const secrets = new EncryptedSecretStore(config.encryptionKey);
  const oauthLogins = new PiOAuthLogins();
  const home = new LocalAgentHomeStore(config.dataDir);
  const memory = new MarkdownMemoryStore(prisma);
  const connectors = createConnectorStack(isComposioEnabled(config.composioApiKey));
  const destination: DestinationEmulator = connectors.destination;
  await destination.start();
  void connectors.composio?.warmDirectory().catch(() => undefined);
  const runtime =
    config.agentRuntime === "scripted" ? new ScriptedAgentRuntime() : new PiAgentRuntime();
  const notifications = new ExpoPushProvider(config.dataDir);
  const executor = createRunExecutor({
    prisma,
    runtime,
    sandbox,
    memory,
    home,
    connector: connectors.connector,
    secrets: [config.openRouterKey ?? "", config.composioApiKey ?? ""].filter(Boolean),
    secretStore: secrets,
    deploymentModelKey: config.openRouterKey,
    dataDir: config.dataDir,
    notifications,
    wakeup,
  });

  return {
    prisma,
    pool: created.pool,
    wakeup,
    sandbox,
    secrets,
    oauthLogins,
    home,
    memory,
    destination,
    composio: connectors.composio,
    runtime,
    notifications,
    executor,
    async startWakeup(owner: string) {
      await wakeup.start({
        "run.continue": async (payload) => {
          await executor.continueRun(String(payload.runId), owner);
        },
        "routine.wakeup": async (payload) => {
          await executor.wakeRoutine(String(payload.routineId), owner);
        },
        "computer.sleep": async (payload) => {
          await sleepComputerIfIdle({ prisma, sandbox, wakeup }, String(payload.botId));
        },
      });
    },
    async stop() {
      oauthLogins.abortAll();
      await wakeup.stop();
      await destination.stop();
      await prisma.$disconnect().catch(() => undefined);
      await created.pool?.end().catch(() => undefined);
    },
  };
}
