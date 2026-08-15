import { resolveEncryptionKey, resolveSupervisorToken } from "@cowork/core";
import { loadRootEnv } from "@cowork/core/load-root-env";

loadRootEnv();

import { createRuntimeStack } from "@cowork/adapters";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const stack = await createRuntimeStack({
    databaseUrl,
    dataDir: process.env.DATA_DIR ?? "./data",
    encryptionKey: resolveEncryptionKey(process.env),
    sandboxProvider: process.env.SANDBOX_PROVIDER ?? "docker",
    sandboxSupervisorUrl: process.env.SANDBOX_SUPERVISOR_URL ?? "http://127.0.0.1:7091",
    sandboxSupervisorToken: resolveSupervisorToken(process.env),
    e2bApiKey: process.env.E2B_API_KEY,
    composioApiKey: process.env.COMPOSIO_API_KEY,
    agentRuntime: process.env.AGENT_RUNTIME ?? "pi",
    wakeupDriver: process.env.WAKEUP_DRIVER ?? "graphile",
    openRouterKey: process.env.OPENROUTER_API_KEY,
  });
  await stack.startWakeup(process.pid.toString());
  console.log("cowork worker ready");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
