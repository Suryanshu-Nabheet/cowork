import { describe, expect, it } from "vitest";
import { projectMessages } from "./events.js";

describe("projectMessages", () => {
  it("replays durable messages and trailing live tokens from progress events", () => {
    const messages = projectMessages([
      {
        id: "e1",
        threadId: "t1",
        seq: 0,
        type: "thread.message.created",
        payload: { messageId: "m1", role: "user", blocks: [{ kind: "text", text: "hi" }] },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "e2",
        threadId: "t1",
        seq: 1,
        type: "thread.progress",
        runId: "r1",
        payload: { text: "Lis", streaming: true },
        createdAt: "2026-01-01T00:00:01.000Z",
      },
      {
        id: "e3",
        threadId: "t1",
        seq: 2,
        type: "thread.progress",
        runId: "r1",
        payload: { text: "Lisbon", streaming: true },
        createdAt: "2026-01-01T00:00:02.000Z",
      },
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.blocks[0]).toEqual({ kind: "text", text: "hi" });
    expect(messages[1]?.blocks[0]).toEqual({ kind: "progress", text: "Lisbon" });
  });

  it("drops streaming tokens once the completed message is durable", () => {
    const messages = projectMessages([
      {
        id: "e1",
        threadId: "t1",
        seq: 0,
        type: "thread.progress",
        runId: "r1",
        payload: { text: "Lisbon", streaming: true },
        createdAt: "2026-01-01T00:00:01.000Z",
      },
      {
        id: "e2",
        threadId: "t1",
        seq: 1,
        type: "thread.message.created",
        runId: "r1",
        payload: { messageId: "m2", role: "bot", blocks: [{ kind: "text", text: "Lisbon" }] },
        createdAt: "2026-01-01T00:00:03.000Z",
      },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.blocks[0]).toEqual({ kind: "text", text: "Lisbon" });
  });

  it("keeps live subagent cards until a durable subagent message arrives", () => {
    const live = projectMessages([
      {
        id: "e1",
        threadId: "t1",
        seq: 0,
        type: "thread.subagent",
        runId: "r1",
        payload: {
          agentId: "a1",
          name: "helper",
          task: "summarize",
          status: "running",
          progress: "working…",
        },
        createdAt: "2026-01-01T00:00:01.000Z",
      },
    ]);
    expect(live).toHaveLength(1);
    expect(live[0]?.blocks[0]).toMatchObject({
      kind: "subagent",
      name: "helper",
      status: "running",
    });

    const durable = projectMessages([
      {
        id: "e1",
        threadId: "t1",
        seq: 0,
        type: "thread.subagent",
        runId: "r1",
        payload: {
          agentId: "a1",
          name: "helper",
          task: "summarize",
          status: "running",
        },
        createdAt: "2026-01-01T00:00:01.000Z",
      },
      {
        id: "e2",
        threadId: "t1",
        seq: 1,
        type: "thread.message.created",
        runId: "r1",
        payload: {
          messageId: "m1",
          role: "bot",
          blocks: [
            {
              kind: "subagent",
              agentId: "a1",
              name: "helper",
              task: "summarize",
              status: "completed",
              result: "ok",
            },
          ],
        },
        createdAt: "2026-01-01T00:00:02.000Z",
      },
    ]);
    expect(durable).toHaveLength(1);
    expect(durable[0]?.blocks[0]).toMatchObject({ status: "completed", result: "ok" });
  });

  it("keeps live tool traces until a durable tool message arrives", () => {
    const live = projectMessages([
      {
        id: "e1",
        threadId: "t1",
        seq: 0,
        type: "thread.tool",
        runId: "r1",
        payload: {
          executionId: "ex1",
          name: "shell",
          status: "running",
          detail: "ls",
        },
        createdAt: "2026-01-01T00:00:01.000Z",
      },
    ]);
    expect(live[0]?.blocks[0]).toMatchObject({ kind: "tool", name: "shell", status: "running" });
  });

  it("drops streaming tokens on failed and cancelled runs", () => {
    const failed = projectMessages([
      {
        id: "e1",
        threadId: "t1",
        seq: 0,
        type: "thread.progress",
        runId: "r1",
        payload: { text: "halfway", streaming: true },
        createdAt: "2026-01-01T00:00:01.000Z",
      },
      {
        id: "e2",
        threadId: "t1",
        seq: 1,
        type: "run.failed",
        runId: "r1",
        payload: { error: "boom" },
        createdAt: "2026-01-01T00:00:02.000Z",
      },
    ]);
    expect(failed).toHaveLength(0);

    const cancelled = projectMessages([
      {
        id: "e1",
        threadId: "t1",
        seq: 0,
        type: "thread.progress",
        runId: "r1",
        payload: { text: "halfway", streaming: true },
        createdAt: "2026-01-01T00:00:01.000Z",
      },
      {
        id: "e2",
        threadId: "t1",
        seq: 1,
        type: "run.cancelled",
        runId: "r1",
        payload: { status: "cancelled" },
        createdAt: "2026-01-01T00:00:02.000Z",
      },
    ]);
    expect(cancelled).toHaveLength(0);
  });

  it("maps cancelled subagent payloads", () => {
    const live = projectMessages([
      {
        id: "e1",
        threadId: "t1",
        seq: 0,
        type: "thread.subagent",
        runId: "r1",
        payload: {
          agentId: "a1",
          name: "helper",
          task: "summarize",
          status: "cancelled",
          result: "stopped",
        },
        createdAt: "2026-01-01T00:00:01.000Z",
      },
    ]);
    expect(live[0]?.blocks[0]).toMatchObject({ kind: "subagent", status: "cancelled" });
  });
});
