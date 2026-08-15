import type { SandboxProvider, WakeupDriver } from "@cowork/adapter-kit";
import {
  type ComposioConnector,
  createRuntimeStack,
  type DestinationEmulator,
  type RunExecutor,
} from "@cowork/adapters";
import { blockedAuthPaths, createAuth } from "@cowork/auth";
import { type PrismaClient, requireMembership } from "@cowork/db";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { type AppEnv, loadEnv } from "./env.js";
import { createRouter } from "./router.js";

export interface AppHandles {
  app: Hono;
  prisma: PrismaClient;
  wakeup: WakeupDriver;
  sandbox: SandboxProvider;
  connector: DestinationEmulator;
  composio?: ComposioConnector;
  executor: RunExecutor;
  stop: () => Promise<void>;
}

export async function createApp(
  overrides: Partial<AppEnv> & { prisma?: PrismaClient } = {},
): Promise<AppHandles> {
  const env = { ...loadEnv(process.env), ...overrides };
  const stack = await createRuntimeStack({
    databaseUrl: env.databaseUrl,
    dataDir: env.dataDir,
    encryptionKey: env.encryptionKey,
    sandboxProvider: env.sandboxProvider,
    sandboxSupervisorUrl: env.sandboxSupervisorUrl,
    sandboxSupervisorToken: env.sandboxSupervisorToken,
    e2bApiKey: env.e2bApiKey,
    composioApiKey: env.composioApiKey,
    agentRuntime: env.agentRuntime,
    wakeupDriver: env.wakeupDriver,
    openRouterKey: env.openRouterKey,
    prisma: overrides.prisma,
  });
  const { prisma, wakeup, sandbox, executor } = stack;
  await prisma.deploymentSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });

  const auth = createAuth(prisma, {
    secret: env.authSecret,
    baseURL: env.authUrl,
    webOrigin: env.webOrigin,
    signupsEnabled: env.signupsEnabled,
    signupAllowlist: env.signupAllowlist,
    extraOrigins: [
      "cowork://",
      "exp://",
      "exp://*",
      "http://localhost:8081",
      "http://127.0.0.1:8081",
      "http://localhost:19006",
      "http://127.0.0.1:19006",
    ],
  });

  if (env.wakeupDriver !== "graphile") {
    await stack.startWakeup("api");
  }

  const router = createRouter({
    prisma,
    auth,
    wakeup,
    sandbox,
    memory: stack.memory,
    home: stack.home,
    secrets: stack.secrets,
    oauthLogins: stack.oauthLogins,
    composio: stack.composio,
    dataDir: env.dataDir,
    pool: stack.pool,
    env: {
      defaultProvider: env.defaultProvider,
      defaultModel: env.defaultModel,
      openRouterKey: env.openRouterKey,
      webOrigin: env.webOrigin,
      screenProxySecret: env.authSecret,
      sandboxProvider: env.sandboxProvider,
    },
  });
  const rpc = new RPCHandler(router);
  const app = new Hono();
  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) return env.webOrigin;
        return isTrustedOrigin(origin, env) ? origin : "";
      },
      credentials: true,
    }),
  );
  app.on(["GET", "POST"], "/api/auth/*", async (c) => {
    const path = new URL(c.req.url).pathname.replace("/api/auth", "");
    if (blockedAuthPaths.some((blocked) => path.startsWith(blocked))) {
      return c.json({ error: "Not available in version 1" }, 404);
    }
    return auth.handler(c.req.raw);
  });
  app.use("/rpc/*", async (c, next) => {
    const session = await auth.api.getSession({ headers: sessionHeaders(c.req.raw) });
    const actor = session?.user
      ? await requireMembership(prisma, session.user.id).catch(() => null)
      : null;
    const { matched, response } = await rpc.handle(c.req.raw, {
      prefix: "/rpc",
      context: { actor, signal: c.req.raw.signal },
    });
    if (matched) return c.newResponse(response.body, response);
    await next();
  });
  app.get("/health", (c) =>
    c.json({
      ok: true,
      runtime: env.agentRuntime,
      sandbox: env.sandboxProvider,
      composio: Boolean(stack.composio),
      wakeup: env.wakeupDriver,
    }),
  );

  return {
    app,
    prisma,
    wakeup,
    sandbox,
    connector: stack.destination,
    composio: stack.composio,
    executor,
    stop: () => stack.stop(),
  };
}

export function isTrustedOrigin(origin: string, env: AppEnv) {
  if (!origin) return true;
  if (origin === env.webOrigin || origin === env.apiUrl || origin === env.authUrl) return true;
  if (origin.startsWith("cowork://") || origin.startsWith("exp://")) return true;
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

function sessionHeaders(request: Request) {
  const headers = new Headers(request.headers);
  const authz = headers.get("authorization");
  if (authz?.toLowerCase().startsWith("bearer ") && !headers.get("cookie")) {
    headers.set("cookie", `better-auth.session_token=${authz.slice(7).trim()}`);
  }
  return headers;
}
