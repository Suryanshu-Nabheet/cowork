import type { AdapterContext, WakeupDriver, WakeupJob } from "@cowork/adapter-kit";
import { quickAddJob, run } from "graphile-worker";

export class GraphileWakeupDriver implements WakeupDriver {
  private runner: Awaited<ReturnType<typeof run>> | undefined;

  constructor(private readonly connectionString: string) {}

  describe() {
    return {
      id: "graphile",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { cron: true, delay: true },
    };
  }

  async enqueue(job: WakeupJob): Promise<void> {
    await quickAddJob({ connectionString: this.connectionString }, job.name, job.payload, {
      runAt: job.runAt,
      jobKey: job.jobKey,
      jobKeyMode: job.jobKey ? "replace" : undefined,
    });
  }

  async start(
    handlers: Record<string, (payload: Record<string, unknown>) => Promise<void>>,
  ): Promise<void> {
    const taskList: Record<string, (payload: unknown) => Promise<void>> = {};
    for (const [name, handler] of Object.entries(handlers)) {
      taskList[name] = async (payload) => {
        await handler((payload ?? {}) as Record<string, unknown>);
      };
    }
    this.runner = await run({
      connectionString: this.connectionString,
      concurrency: 4,
      pollInterval: 500,
      taskList,
    });
  }

  async stop(): Promise<void> {
    await this.runner?.stop();
  }
}

export class InMemoryWakeupDriver implements WakeupDriver {
  private handlers: Record<string, (payload: Record<string, unknown>) => Promise<void>> = {};
  private timers: NodeJS.Timeout[] = [];
  private keyed = new Map<string, NodeJS.Timeout>();

  describe() {
    return {
      id: "memory",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { cron: true, delay: true },
    };
  }

  async enqueue(job: WakeupJob, _context?: AdapterContext): Promise<void> {
    const delay = job.runAt ? Math.max(0, job.runAt.getTime() - Date.now()) : 0;
    if (job.jobKey) {
      const existing = this.keyed.get(job.jobKey);
      if (existing) {
        clearTimeout(existing);
        this.timers = this.timers.filter((timer) => timer !== existing);
      }
    }
    const timer = setTimeout(() => {
      if (job.jobKey) this.keyed.delete(job.jobKey);
      const handler = this.handlers[job.name];
      if (!handler) {
        console.error(`No wakeup handler for ${job.name}`);
        return;
      }
      void handler(job.payload).catch((error) => console.error(job.name, error));
    }, delay);
    this.timers.push(timer);
    if (job.jobKey) this.keyed.set(job.jobKey, timer);
  }

  async start(
    handlers: Record<string, (payload: Record<string, unknown>) => Promise<void>>,
  ): Promise<void> {
    this.handlers = handlers;
  }

  async stop(): Promise<void> {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.keyed.clear();
  }
}
