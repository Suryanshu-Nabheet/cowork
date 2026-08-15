import type {
  AdapterContext,
  AgentRunRequest,
  AgentRuntime,
  AgentRuntimeEvent,
  ConnectorTool,
} from "@cowork/adapter-kit";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { createProvider, envApiKeyAuth, Type } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { builtinAgentTools, DELEGATION_TOOL_NAMES } from "./builtin-tools.js";
import { toolDetail } from "./tool-detail.js";

const running = new Map<string, AbortController>();
const subagents = new Map<
  string,
  { runId: string; abort: AbortController; nested: Agent; name: string; task: string }
>();
const models = builtinModels();
const MAX_PARALLEL_SUBAGENTS = 4;

function resolveModel(provider: string, modelId: string) {
  let cleanId = modelId ? modelId.replace(/^ollama:/, "").trim() : "";
  if (!cleanId || cleanId === "default") {
    cleanId = "qwen3.5:2b";
  }
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1";

  if (provider === "ollama" || provider === "local" || !provider) {
    let p = models.getProvider("ollama");
    const dynamicModel = {
      id: cleanId,
      name: cleanId,
      api: "openai-completions" as const,
      provider: "ollama",
      baseUrl: ollamaBaseUrl,
      reasoning: false,
      input: ["text" as const],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32768,
      maxTokens: 8192,
    };
    const existingModels = p ? p.getModels() : [];
    p = createProvider({
      id: "ollama",
      name: "Ollama",
      baseUrl: ollamaBaseUrl,
      auth: { apiKey: envApiKeyAuth("Ollama (Local)", ["OLLAMA_API_KEY"]) },
      models: [...existingModels.filter((m) => m.id !== cleanId), dynamicModel],
      api: openAICompletionsApi(),
    });
    models.setProvider(p);
    return dynamicModel;
  }

  const model = models.getModel(provider, cleanId);
  return model ?? models.getModel("openrouter", cleanId) ?? models.getModel("ollama", cleanId);
}

export function abortActiveRun(runId: string): void {
  running.get(runId)?.abort();
  abortSubagentsForRun(runId);
}

export function abortSubagent(agentId: string): boolean {
  const row = subagents.get(agentId);
  if (!row) return false;
  row.abort.abort();
  row.nested.abort();
  return true;
}

export function abortSubagentsForRun(runId: string): void {
  for (const row of subagents.values()) {
    if (row.runId === runId) {
      row.abort.abort();
      row.nested.abort();
    }
  }
}

export class PiAgentRuntime implements AgentRuntime {
  describe() {
    return {
      id: "pi",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { streaming: true, compaction: true, tools: true, scripted: false },
    };
  }

  async abort(runId: string): Promise<void> {
    abortActiveRun(runId);
  }

  async *run(request: AgentRunRequest, context: AdapterContext): AsyncIterable<AgentRuntimeEvent> {
    const controller = new AbortController();
    running.set(request.runId, controller);
    if (context.signal) {
      if (context.signal.aborted) {
        controller.abort();
      } else {
        context.signal.addEventListener("abort", () => controller.abort(), { once: true });
      }
    }
    const signal = controller.signal;
    const queue = createQueue();

    const work = (async () => {
      try {
        const provider = request.model.provider || "ollama";
        const modelId = request.model.id || "qwen3.5:2b";
        const model = resolveModel(provider, modelId);
        if (!model) {
          queue.push({ type: "text", text: `Unknown model ${provider}/${modelId}` });
          queue.push({ type: "done" });
          return;
        }

        const apiKey =
          request.model.apiKey ??
          (provider === "ollama" ? "ollama" : process.env.OPENROUTER_API_KEY);
        const toolDefs = request.tools.length ? request.tools : builtinAgentTools;
        const nestedAgents = new Set<Agent>();
        const host: ToolHost = {
          queue,
          request,
          model,
          apiKey,
          nestedAgents,
          subagentGate: createGate(MAX_PARALLEL_SUBAGENTS),
          signal,
          depth: 0,
        };
        const tools = toolDefs.map((tool) => toAgentTool(tool, host));
        const history = toHistory(request.history, request.prompt);

        const agent = new Agent({
          streamFn: (m, ctx, options) => models.streamSimple(m, ctx, options),
          getApiKey: async () => apiKey,
          initialState: {
            systemPrompt:
              request.instructions ||
              "You are a CoWork bot with a real computer. Use write_file, shell, remember, and request_takeover when they are the right tools. Be concise.",
            model,
            thinkingLevel: "off",
            tools,
            messages: history,
          },
        });

        if (signal.aborted) {
          queue.push({ type: "done", text: "stopped" });
          return;
        }
        const onAbort = () => {
          agent.abort();
          for (const nested of nestedAgents) nested.abort();
        };
        signal.addEventListener("abort", onAbort);

        let streamed = "";
        agent.subscribe((event) => {
          if (event.type === "message_update") {
            if (event.assistantMessageEvent.type === "text_delta") {
              const delta = event.assistantMessageEvent.delta;
              if (delta) {
                streamed += delta;
                queue.push({ type: "text", text: delta });
              }
            } else if (event.assistantMessageEvent.type === "thinking_delta") {
              const delta = event.assistantMessageEvent.delta;
              if (delta) {
                queue.push({ type: "thought", text: delta });
              }
            }
          }
          if (event.type === "message_end" && event.message.role === "assistant") {
            const text = assistantText(event.message);
            if (text && !streamed) {
              streamed = text;
              queue.push({ type: "text", text });
            }
            if ("usage" in event.message && event.message.usage) {
              queue.push({
                type: "usage",
                inputTokens: event.message.usage.input ?? 0,
                outputTokens: event.message.usage.output ?? 0,
                provider: model.provider,
                model: model.id,
              });
            }
          }
        });

        await agent.prompt(request.prompt);
        await agent.waitForIdle();
        signal.removeEventListener("abort", onAbort);

        const error = agent.state.errorMessage;
        if (error) {
          queue.push({ type: "text", text: `I hit a problem: ${sanitizeError(error)}` });
          queue.push({ type: "done", text: sanitizeError(error) });
          return;
        }
        if (!streamed) {
          const fallback = assistantText(agent.state.messages.at(-1)) || "I finished the work.";
          queue.push({ type: "text", text: fallback });
          streamed = fallback;
        }
        queue.push({ type: "done", text: streamed });
      } catch (error) {
        const message = sanitizeError(error instanceof Error ? error.message : String(error));
        queue.push({ type: "text", text: `I hit a problem: ${message}` });
        queue.push({ type: "done", text: message });
      } finally {
        queue.close();
      }
    })();

    try {
      yield* queue.iterate();
      await work;
    } finally {
      running.delete(request.runId);
    }
  }
}

function toHistory(history: AgentRunRequest["history"], prompt: string) {
  const last = history.at(-1);
  const prior = last?.role === "user" && last.content === prompt ? history.slice(0, -1) : history;
  return prior
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) =>
      m.role === "assistant"
        ? { role: "user" as const, content: `Assistant: ${m.content}`, timestamp: Date.now() }
        : { role: "user" as const, content: m.content, timestamp: Date.now() },
    );
}

function toAgentTool(tool: ConnectorTool, host: ToolHost): AgentTool {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: parametersFor(tool),
    prepareArguments: (args: unknown) => {
      const raw = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
      if (tool.name === "destination.write") {
        return {
          collection: String(raw.collection ?? "notes"),
          title: String(raw.title ?? "CoWork result"),
          body: String(raw.body ?? ""),
        };
      }
      if (tool.name === "remember") {
        return { content: String(raw.content ?? ""), path: String(raw.path ?? "MEMORY.md") };
      }
      if (tool.name === "request_takeover") {
        return { reason: String(raw.reason ?? "I need you on the screen.") };
      }
      if (tool.name === "write_file") {
        return { path: String(raw.path ?? "notes/result.txt"), content: String(raw.content ?? "") };
      }
      if (tool.name === "shell") {
        return {
          command: String(raw.command ?? ""),
          cwd: raw.cwd ? String(raw.cwd) : "/home/cowork",
        };
      }
      if (tool.name === "run_subagent") {
        return {
          name: String(raw.name ?? "helper"),
          task: String(raw.task ?? ""),
          instructions: raw.instructions ? String(raw.instructions) : "",
        };
      }
      if (tool.name === "spawn_bot") {
        return {
          name: String(raw.name ?? ""),
          title: raw.title ? String(raw.title) : "",
          instructions: raw.instructions ? String(raw.instructions) : "",
          prompt: raw.prompt ? String(raw.prompt) : "",
        };
      }
      if (tool.name === "delete_bot") {
        return {
          confirm_name: String(raw.confirm_name ?? raw.confirmName ?? ""),
          bot_id: raw.bot_id ? String(raw.bot_id) : raw.botId ? String(raw.botId) : "",
        };
      }
      return raw as never;
    },
    execute: async (toolCallId, params) => {
      const args = (params ?? {}) as Record<string, unknown>;
      const executionId =
        toolCallId ||
        `${host.request.runId}:${host.depth ? `sub-${host.depth}:` : ""}${tool.name}:${Date.now()}`;
      host.queue.push({
        type: "tool",
        name: tool.name,
        args,
        executionId,
        status: "running",
        detail: toolDetail(tool.name, args),
      });
      if (tool.name === "request_takeover") {
        host.queue.push({
          type: "takeover",
          reason: String(args.reason ?? "I need you on the screen."),
        });
        host.queue.push({
          type: "tool",
          name: tool.name,
          args,
          executionId,
          status: "completed",
          detail: toolDetail(tool.name, args),
          result: "Takeover requested.",
        });
        return {
          content: [{ type: "text", text: "Takeover requested." }],
          details: args,
          terminate: true,
        };
      }
      if (tool.name === "run_subagent") {
        const result = await executeSubagent(host, executionId, args);
        return {
          content: [{ type: "text", text: result }],
          details: { result },
        };
      }
      try {
        if (host.request.executeTool) {
          const result = await host.request.executeTool(tool.name, args, executionId);
          const summary = summarizeToolResult(result);
          const failed = isToolFailure(result);
          host.queue.push({
            type: "tool",
            name: tool.name,
            args,
            executionId,
            status: failed ? "failed" : "completed",
            detail: toolDetail(tool.name, args),
            result: summary,
          });
          return {
            content: [{ type: "text", text: summary }],
            details: result,
          };
        }
        host.queue.push({
          type: "tool",
          name: tool.name,
          args,
          executionId,
          status: "failed",
          detail: toolDetail(tool.name, args),
          result: `${tool.name} is unavailable without an executor.`,
        });
        return {
          content: [{ type: "text", text: `${tool.name} is unavailable without an executor.` }],
          details: { error: "no executor" },
        };
      } catch (error) {
        const message = sanitizeError(error instanceof Error ? error.message : String(error));
        host.queue.push({
          type: "tool",
          name: tool.name,
          args,
          executionId,
          status: "failed",
          detail: toolDetail(tool.name, args),
          result: message,
        });
        throw error;
      }
    },
  };
}

async function executeSubagent(host: ToolHost, executionId: string, args: Record<string, unknown>) {
  if (host.depth > 0) return "Subagents cannot nest further.";
  await host.subagentGate.acquire();
  const agentId = executionId;
  const name =
    String(args.name ?? "helper")
      .trim()
      .slice(0, 80) || "helper";
  const task = String(args.task ?? "").trim();
  const extra = args.instructions ? String(args.instructions).trim() : "";
  host.queue.push({
    type: "subagent",
    agentId,
    name,
    task,
    status: "running",
    progress: "starting…",
  });

  const childDefs = (host.request.tools.length ? host.request.tools : builtinAgentTools).filter(
    (tool) => !DELEGATION_TOOL_NAMES.has(tool.name),
  );
  const childAbort = new AbortController();
  const nestedHost: ToolHost = { ...host, depth: 1, signal: childAbort.signal };
  const nested = new Agent({
    streamFn: (m, ctx, options) => models.streamSimple(m, ctx, options),
    getApiKey: async () => host.apiKey,
    initialState: {
      systemPrompt: [
        `You are a CoWork subagent named "${name}".`,
        "You run inside the parent bot's turn — you are not a separate bot chat.",
        "Complete the task and return a concise result. Do not spawn bots or further subagents.",
        extra,
      ]
        .filter(Boolean)
        .join(" "),
      model: host.model,
      thinkingLevel: "off",
      tools: childDefs.map((tool) => toAgentTool(tool, nestedHost)),
      messages: [],
    },
  });
  host.nestedAgents.add(nested);
  subagents.set(agentId, {
    runId: host.request.runId,
    abort: childAbort,
    nested,
    name,
    task,
  });

  let streamed = "";
  let lastPush = 0;
  const actions: string[] = [];
  nested.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      const toolName = "toolName" in event && event.toolName ? String(event.toolName) : "a tool";
      actions.push(`Running ${toolName}…`);
      host.queue.push({
        type: "subagent",
        agentId,
        name,
        task,
        status: "running",
        progress: `using ${toolName}…`,
        actions: [...actions],
      });
    }
    if (event.type === "tool_execution_end") {
      const toolName = "toolName" in event && event.toolName ? String(event.toolName) : "a tool";
      actions.push(`Completed ${toolName}`);
      host.queue.push({
        type: "subagent",
        agentId,
        name,
        task,
        status: "running",
        progress: `finished ${toolName}`,
        actions: [...actions],
      });
    }
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      const delta = event.assistantMessageEvent.delta;
      if (delta) {
        streamed += delta;
        const now = Date.now();
        if (now - lastPush >= 80) {
          lastPush = now;
          host.queue.push({
            type: "subagent",
            agentId,
            name,
            task,
            status: "running",
            progress: streamed.slice(-800),
            actions: [...actions],
          });
        }
      }
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      const text = assistantText(event.message);
      if (text && !streamed) streamed = text;
      if ("usage" in event.message && event.message.usage) {
        host.queue.push({
          type: "usage",
          inputTokens: event.message.usage.input ?? 0,
          outputTokens: event.message.usage.output ?? 0,
          provider: host.model.provider,
          model: host.model.id,
        });
      }
    }
  });

  const emitStopped = (status: "failed" | "cancelled", result: string) => {
    host.queue.push({
      type: "subagent",
      agentId,
      name,
      task,
      status,
      result,
      actions: [...actions],
    });
  };

  try {
    if (host.signal.aborted || childAbort.signal.aborted) {
      emitStopped("cancelled", "stopped");
      return "stopped";
    }
    const onParentAbort = () => {
      childAbort.abort();
      nested.abort();
    };
    host.signal.addEventListener("abort", onParentAbort);
    childAbort.signal.addEventListener("abort", () => nested.abort());
    await nested.prompt(task || "Complete the delegated task.");
    await nested.waitForIdle();
    host.signal.removeEventListener("abort", onParentAbort);
    if (host.signal.aborted || childAbort.signal.aborted) {
      emitStopped("cancelled", "stopped");
      return "stopped";
    }
    const error = nested.state.errorMessage;
    if (error) {
      const message = sanitizeError(error);
      emitStopped("failed", message);
      return `Subagent failed: ${message}`;
    }
    const result = streamed || assistantText(nested.state.messages.at(-1)) || "done.";
    const clipped = result.length > 12_000 ? `${result.slice(0, 12_000)}…` : result;
    host.queue.push({
      type: "subagent",
      agentId,
      name,
      task,
      status: "completed",
      result: clipped,
      actions: [...actions],
    });
    return clipped;
  } catch (error) {
    if (host.signal.aborted || childAbort.signal.aborted) {
      emitStopped("cancelled", "stopped");
      return "stopped";
    }
    const message = sanitizeError(error instanceof Error ? error.message : String(error));
    emitStopped("failed", message);
    return `Subagent failed: ${message}`;
  } finally {
    host.nestedAgents.delete(nested);
    subagents.delete(agentId);
    host.subagentGate.release();
  }
}

function parametersFor(tool: ConnectorTool) {
  if (tool.name === "write_file") {
    return Type.Object({ path: Type.String(), content: Type.String() });
  }
  if (tool.name === "destination.write") {
    return Type.Object({
      collection: Type.String(),
      title: Type.String(),
      body: Type.String(),
    });
  }
  if (tool.name === "request_takeover") {
    return Type.Object({ reason: Type.String() });
  }
  if (tool.name === "remember") {
    return Type.Object({ content: Type.String(), path: Type.String() });
  }
  if (tool.name === "shell") {
    return Type.Object({
      command: Type.String(),
      cwd: Type.String(),
    });
  }
  if (tool.name === "run_subagent") {
    return Type.Object({
      name: Type.String(),
      task: Type.String(),
      instructions: Type.Optional(Type.String()),
    });
  }
  if (tool.name === "spawn_bot") {
    return Type.Object({
      name: Type.String(),
      title: Type.Optional(Type.String()),
      instructions: Type.Optional(Type.String()),
      prompt: Type.Optional(Type.String()),
    });
  }
  if (tool.name === "delete_bot") {
    return Type.Object({
      confirm_name: Type.String(),
      bot_id: Type.Optional(Type.String()),
    });
  }
  return jsonSchemaParameters(tool.inputSchema);
}

function jsonSchemaParameters(schema: Record<string, unknown>) {
  const properties = (schema.properties ?? {}) as Record<string, unknown>;
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  const fields: Record<string, ReturnType<typeof Type.Optional>> = {};
  for (const [key, spec] of Object.entries(properties)) {
    const field = jsonField(spec);
    fields[key] = (required.has(key) ? field : Type.Optional(field)) as unknown as ReturnType<
      typeof Type.Optional
    >;
  }
  return Type.Object(fields);
}

function jsonField(spec: unknown): ReturnType<typeof Type.String> {
  const type =
    spec && typeof spec === "object" && "type" in spec
      ? String((spec as { type?: unknown }).type)
      : "string";
  if (type === "number" || type === "integer") return Type.Number() as never;
  if (type === "boolean") return Type.Boolean() as never;
  if (type === "array") return Type.Array(Type.Unknown()) as never;
  if (type === "object") return Type.Record(Type.String(), Type.Unknown()) as never;
  return Type.String();
}

function summarizeToolResult(result: unknown) {
  try {
    const text = JSON.stringify(result);
    if (!text) return "ok";
    return text.length > 12_000 ? `${text.slice(0, 12_000)}…` : text;
  } catch {
    return "ok";
  }
}

function isToolFailure(result: unknown) {
  return Boolean(
    result &&
      typeof result === "object" &&
      "error" in result &&
      (result as { error?: unknown }).error,
  );
}

function assistantText(message: unknown): string {
  if (!message || typeof message !== "object" || !("content" in message)) return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part
        ? String(part.text)
        : "",
    )
    .join("");
}

function sanitizeError(message: string) {
  return message
    .replace(/sk-or-v1-[a-zA-Z0-9]+/g, "[redacted]")
    .replace(/sk-[a-zA-Z0-9-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, "[redacted]")
    .replace(/COMPOSIO_API_KEY[=:]?\s*\S+/gi, "COMPOSIO_API_KEY=[redacted]");
}

interface EventQueue {
  push(event: AgentRuntimeEvent): void;
  close(): void;
  iterate(): AsyncIterable<AgentRuntimeEvent>;
}

interface ToolHost {
  queue: EventQueue;
  request: AgentRunRequest;
  model: NonNullable<ReturnType<typeof models.getModel>>;
  apiKey: string | undefined;
  nestedAgents: Set<Agent>;
  subagentGate: { acquire(): Promise<void>; release(): void };
  signal: AbortSignal;
  depth: number;
}

function createGate(max: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  return {
    async acquire() {
      if (active >= max) {
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
        });
      }
      active += 1;
    },
    release() {
      active = Math.max(0, active - 1);
      waiters.shift()?.();
    },
  };
}

function createQueue(): EventQueue {
  const items: AgentRuntimeEvent[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  return {
    push(event) {
      items.push(event);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    async *iterate() {
      while (!closed || items.length) {
        if (items.length) {
          yield items.shift()!;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}
