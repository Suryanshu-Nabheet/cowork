import type { SandboxProvider, WakeupDriver } from "@cowork/adapter-kit";
import type { PrismaClient } from "@cowork/db";
import { appendEvent } from "@cowork/db";

export const DEFAULT_SANDBOX_IDLE_MS = 10 * 60 * 1000;

const ACTIVE_RUN = ["queued", "leased", "running", "waiting_input", "waiting_takeover"] as const;

export function sandboxIdleMs(): number {
  const raw = Number(process.env.SANDBOX_IDLE_MS ?? DEFAULT_SANDBOX_IDLE_MS);
  return Number.isFinite(raw) && raw >= 30_000 ? raw : DEFAULT_SANDBOX_IDLE_MS;
}

export function scheduleComputerSleep(wakeup: WakeupDriver | undefined, botId: string): void {
  if (!wakeup || !botId) return;
  void wakeup.enqueue({
    name: "computer.sleep",
    payload: { botId },
    runAt: new Date(Date.now() + sandboxIdleMs()),
    jobKey: `computer.sleep:${botId}`,
  });
}

export async function touchRunningComputer(
  deps: { sandbox: SandboxProvider; wakeup?: WakeupDriver },
  computer: { botId: string; providerRef: string; kind: string },
): Promise<void> {
  scheduleComputerSleep(deps.wakeup, computer.botId);
  const sandbox = deps.sandbox as SandboxProvider & {
    keepAlive?: (ref: {
      id: string;
      botId: string;
      kind: "docker" | "e2b" | "desktop" | "fake";
      providerRef: string;
    }) => Promise<void>;
  };
  await sandbox.keepAlive?.({
    id: computer.providerRef,
    botId: computer.botId,
    kind: computer.kind as "docker" | "e2b" | "desktop" | "fake",
    providerRef: computer.providerRef,
  });
}

export async function sleepComputerIfIdle(
  deps: { prisma: PrismaClient; sandbox: SandboxProvider; wakeup?: WakeupDriver },
  botId: string,
): Promise<void> {
  const computer = await deps.prisma.computer.findUnique({ where: { botId } });
  if (!computer?.providerRef) return;
  if (computer.state !== "running") return;
  const active = await deps.prisma.run.findFirst({
    where: { botId, status: { in: [...ACTIVE_RUN] } },
    select: { id: true },
  });
  if (active) {
    scheduleComputerSleep(deps.wakeup, botId);
    return;
  }
  const ctx = {
    operationId: "computer.sleep",
    traceId: "computer.sleep",
    workspaceId: computer.workspaceId,
    userId: computer.userId,
    botId,
    signal: new AbortController().signal,
  };
  await deps.sandbox.stop(
    {
      id: computer.providerRef,
      botId,
      kind: computer.kind as "docker" | "e2b" | "desktop" | "fake",
      providerRef: computer.providerRef,
    },
    ctx,
  );
  await deps.prisma.computer.update({
    where: { botId },
    data: { state: "suspended", controlHolder: "none" },
  });
  if (computer.botId) {
    const bot = await deps.prisma.bot.findUnique({
      where: { id: botId },
      include: { thread: true },
    });
    if (bot?.thread) {
      await appendEvent(deps.prisma, {
        workspaceId: computer.workspaceId,
        threadId: bot.thread.id,
        botId,
        type: "computer.status",
        payload: { status: "suspended" },
      });
    }
  }
}
