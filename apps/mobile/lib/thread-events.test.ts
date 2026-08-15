import { describe, expect, it } from "vitest";
import { applyMobileThreadEvent, type MobileSnapshot } from "./thread-events";

function snap(over: Partial<MobileSnapshot> = {}): MobileSnapshot {
  return {
    botId: "b",
    threadId: "t",
    cursor: 0,
    messages: [],
    run: { status: "running" },
    computer: { state: "stopped", controlHolder: "none", screenAvailable: false },
    ...over,
  };
}

describe("applyMobileThreadEvent", () => {
  it("clears progress and the active run on failed and cancelled events", () => {
    const withProgress = snap({
      messages: [{ id: "progress:r1", role: "bot", blocks: [{ kind: "progress", text: "hi" }] }],
    });
    expect(applyMobileThreadEvent(withProgress, { type: "run.failed" })?.run).toBeNull();
    expect(applyMobileThreadEvent(withProgress, { type: "run.cancelled" })?.messages).toEqual([]);
  });

  it("upserts live tool traces", () => {
    const next = applyMobileThreadEvent(snap(), {
      type: "thread.tool",
      payload: { executionId: "ex1", name: "shell", status: "running", detail: "ls" },
    });
    expect(next?.messages[0]?.id).toBe("tool:ex1");
    expect(next?.messages[0]?.blocks[0]).toMatchObject({ kind: "tool", name: "shell" });
  });
});
