export type MobileMessage = {
  id: string;
  role: "user" | "bot" | "system";
  blocks: Array<{
    kind: string;
    text?: string;
    state?: string;
    name?: string;
    task?: string;
    status?: string;
    progress?: string;
    result?: string;
    botId?: string;
    title?: string;
    agentId?: string;
    executionId?: string;
  }>;
};

export type MobileSnapshot = {
  botId: string;
  threadId: string;
  cursor?: number;
  messages: MobileMessage[];
  run: { status: string } | null;
  computer: { state: string; controlHolder: string; screenAvailable: boolean };
};

export type ThreadEvent = {
  id?: string;
  type: string;
  seq?: number;
  runId?: string;
  payload?: Record<string, unknown>;
};

export function blockText(message: MobileMessage) {
  return message.blocks
    .map((block) => {
      if (block.kind === "subagent") {
        return `${block.name ?? "subagent"}: ${block.result || block.progress || block.task || ""}`;
      }
      if (block.kind === "child_bot") {
        return `${block.status === "deleted" ? "Deleted" : "Bot"} ${block.name ?? ""}`;
      }
      if (block.kind === "tool") {
        return `${block.name ?? "tool"} ${block.status ?? ""} ${block.text ?? ""}`.trim();
      }
      return block.text ?? block.state ?? "";
    })
    .filter(Boolean)
    .join("\n");
}

export function applyMobileThreadEvent(
  prev: MobileSnapshot | null,
  event: ThreadEvent,
): MobileSnapshot | null {
  if (!prev) return prev;
  if (event.type === "thread.progress") {
    const text = String(event.payload?.text ?? "");
    const streaming: MobileMessage = {
      id: `progress:${event.runId ?? event.id ?? "live"}`,
      role: "bot",
      blocks: [{ kind: "progress", text }],
    };
    return {
      ...prev,
      messages: [
        ...prev.messages.filter((message) => !message.id.startsWith("progress:")),
        streaming,
      ],
    };
  }
  if (event.type === "thread.subagent") {
    const agentId = String(event.payload?.agentId ?? event.id ?? "live");
    const streaming: MobileMessage = {
      id: `subagent:${agentId}`,
      role: "bot",
      blocks: [
        {
          kind: "subagent",
          agentId,
          name: String(event.payload?.name ?? "subagent"),
          task: String(event.payload?.task ?? ""),
          status: String(event.payload?.status ?? "running"),
          progress: event.payload?.progress ? String(event.payload.progress) : undefined,
          result: event.payload?.result ? String(event.payload.result) : undefined,
        },
      ],
    };
    return {
      ...prev,
      messages: [
        ...prev.messages.filter(
          (message) => message.id !== streaming.id && !message.id.startsWith("progress:"),
        ),
        streaming,
      ],
    };
  }
  if (event.type === "thread.message.created") {
    const next: MobileMessage = {
      id: String(event.payload?.messageId ?? event.id ?? `msg:${event.seq ?? 0}`),
      role: (event.payload?.role as MobileMessage["role"]) ?? "bot",
      blocks: (event.payload?.blocks as MobileMessage["blocks"]) ?? [],
    };
    return {
      ...prev,
      messages: [
        ...prev.messages.filter(
          (message) =>
            message.id !== next.id &&
            !message.id.startsWith("progress:") &&
            !(
              message.id.startsWith("subagent:") &&
              next.blocks.some(
                (block) => block.kind === "subagent" && message.id === `subagent:${block.agentId}`,
              )
            ) &&
            !(
              message.id.startsWith("tool:") &&
              next.blocks.some(
                (block) => block.kind === "tool" && message.id === `tool:${block.executionId}`,
              )
            ),
        ),
        next,
      ],
    };
  }
  if (event.type === "thread.tool") {
    const executionId = String(event.payload?.executionId ?? event.id ?? "live");
    const streaming: MobileMessage = {
      id: `tool:${executionId}`,
      role: "bot",
      blocks: [
        {
          kind: "tool",
          name: String(event.payload?.name ?? "tool"),
          status: String(event.payload?.status ?? "running"),
          text: String(event.payload?.detail ?? event.payload?.result ?? ""),
        },
      ],
    };
    return {
      ...prev,
      messages: [
        ...prev.messages.filter(
          (message) => message.id !== streaming.id && !message.id.startsWith("progress:"),
        ),
        streaming,
      ],
    };
  }
  if (
    event.type === "run.completed" ||
    event.type === "run.failed" ||
    event.type === "run.cancelled"
  ) {
    return {
      ...prev,
      run: null,
      messages: prev.messages.filter((message) => !message.id.startsWith("progress:")),
    };
  }
  return prev;
}
