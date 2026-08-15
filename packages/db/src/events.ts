import type { ProductEvent } from "@cowork/contracts";
import type { Notification, Pool, PoolClient } from "pg";
import type { Prisma, PrismaClient } from "./client.js";

export async function appendEvent(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    threadId: string;
    botId: string;
    type: ProductEvent["type"];
    payload: Record<string, unknown>;
    runId?: string;
  },
): Promise<ProductEvent> {
  const event = await prisma.$transaction(async (tx) => {
    const last = await tx.event.findFirst({
      where: { threadId: input.threadId },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    const seq = (last?.seq ?? -1) + 1;
    return tx.event.create({
      data: {
        workspaceId: input.workspaceId,
        threadId: input.threadId,
        botId: input.botId,
        seq,
        type: input.type,
        payload: input.payload as Prisma.InputJsonValue,
        runId: input.runId,
      },
    });
  });
  await prisma.$executeRaw`SELECT pg_notify('cowork_events', ${JSON.stringify({
    workspaceId: event.workspaceId,
    threadId: event.threadId,
    botId: event.botId,
    seq: event.seq,
  })})`;
  return {
    id: event.id,
    workspaceId: event.workspaceId,
    threadId: event.threadId,
    botId: event.botId,
    seq: event.seq,
    type: event.type as ProductEvent["type"],
    runId: event.runId ?? undefined,
    createdAt: event.createdAt.toISOString(),
    payload: event.payload as Record<string, unknown>,
  };
}

export async function eventsAfter(prisma: PrismaClient, threadId: string, cursor: number) {
  return prisma.event.findMany({
    where: { threadId, seq: { gt: cursor } },
    orderBy: { seq: "asc" },
  });
}

export async function* followThreadEvents(
  prisma: PrismaClient,
  threadId: string,
  cursor: number,
  pool?: Pool,
  signal?: AbortSignal,
): AsyncGenerator<Awaited<ReturnType<typeof eventsAfter>>[number]> {
  let seq = cursor;
  const client = pool ? await pool.connect() : undefined;
  try {
    if (client) await client.query("LISTEN cowork_events");
    while (!signal?.aborted) {
      const events = await eventsAfter(prisma, threadId, seq);
      for (const event of events) {
        seq = event.seq;
        yield event;
      }
      if (signal?.aborted) break;
      if (client) await waitForThreadNotify(client, threadId, 15_000, signal);
      else await sleep(400, signal);
    }
  } finally {
    if (client) {
      await client.query("UNLISTEN cowork_events").catch(() => undefined);
      client.release();
    }
  }
}

function waitForThreadNotify(
  client: PoolClient,
  threadId: string,
  ms: number,
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve) => {
    const onNotify = (msg: Notification) => {
      if (msg.channel !== "cowork_events") return;
      try {
        const data = JSON.parse(msg.payload ?? "{}") as { threadId?: string };
        if (data.threadId === threadId) {
          cleanup();
          resolve();
        }
      } catch {
        // ignore malformed payloads
      }
    };
    const onAbort = () => {
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const cleanup = () => {
      clearTimeout(timer);
      client.off("notification", onNotify);
      signal?.removeEventListener("abort", onAbort);
    };
    client.on("notification", onNotify);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}
