import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../pages/SettingsModal.tsx"),
  "utf8",
);

describe("SettingsModal preference controls", () => {
  it("does not probe Ollama while loading other settings tabs", () => {
    expect(source).toContain('if (tab === "ollama") void checkOllamaConnection()');
    expect(source).not.toMatch(/setUsageList\(list\);\s*void checkOllamaConnection\(\)/);
  });

  it("keeps Ollama errors on the Ollama tab", () => {
    expect(source).toContain('tab === "ollama" && ollamaError');
    expect(source).not.toContain('setErrorMsg("Could not reach Ollama');
  });

  it("uses a real switch for the completion chime and previews the sound", () => {
    expect(source).toContain("<Switch");
    expect(source).toContain('aria-label="Completion chime"');
    expect(source).toContain("savePrefs({ soundEnabled: next })");
    expect(source).toContain("playCompletionChime()");
  });

  it("exposes working Smooth/Turbo stream pacing buttons", () => {
    expect(source).toContain('aria-pressed={streamSpeed === "normal"}');
    expect(source).toContain('aria-pressed={streamSpeed === "fast"}');
    expect(source).toContain('savePrefs({ streamSpeed: "normal" })');
    expect(source).toContain('savePrefs({ streamSpeed: "fast" })');
  });
});
