import { describe, expect, it } from "vitest";
import { abortSubagent, abortSubagentsForRun, PiAgentRuntime } from "./pi-runtime.js";
import { toolDetail } from "./tool-detail.js";

describe("Pi agent runtime", () => {
  it("reports an unknown model without calling a provider", async () => {
    const runtime = new PiAgentRuntime();
    const events: string[] = [];
    for await (const event of runtime.run(
      {
        botId: "b",
        threadId: "t",
        runId: "r",
        prompt: "hi",
        instructions: "test",
        history: [],
        tools: [],
        model: { provider: "openrouter", id: "not-a-real-model-xyz" },
      },
      {
        operationId: "1",
        traceId: "1",
        workspaceId: "w",
        userId: "u",
        signal: new AbortController().signal,
      },
    )) {
      if (event.type === "text") events.push(event.text);
    }
    expect(events.join(" ")).toMatch(/Unknown model/i);
  });

  it("resolves dynamic Ollama models automatically", async () => {
    const runtime = new PiAgentRuntime();
    const desc = runtime.describe();
    expect(desc.id).toBe("pi");
    expect(desc.capabilities.streaming).toBe(true);
  });

  it("exposes subagent abort helpers without throwing", () => {
    expect(abortSubagent("missing")).toBe(false);
    expect(() => abortSubagentsForRun("missing-run")).not.toThrow();
    expect(toolDetail("shell", { command: "ls /home/cowork" })).toBe("ls /home/cowork");
    expect(toolDetail("write_file", { path: "notes/a.md" })).toBe("notes/a.md");
  });
});
