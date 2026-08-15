import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPrefs, savePrefs, subscribePrefs } from "./prefs.js";

const store = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => {
    store.clear();
  },
  key: () => null,
  length: 0,
});

afterEach(() => {
  store.clear();
  savePrefs({ soundEnabled: true, streamSpeed: "fast" });
});

describe("prefs", () => {
  it("defaults to chime on and turbo pacing", () => {
    expect(loadPrefs()).toEqual({ soundEnabled: true, streamSpeed: "fast" });
  });

  it("persists stream pacing and notifies subscribers", () => {
    const seen: string[] = [];
    const stop = subscribePrefs(() => seen.push(loadPrefs().streamSpeed));
    const next = savePrefs({ streamSpeed: "normal" });
    expect(next.streamSpeed).toBe("normal");
    expect(loadPrefs().streamSpeed).toBe("normal");
    expect(JSON.parse(store.get("cowork.prefs") ?? "{}").streamSpeed).toBe("normal");
    expect(seen).toEqual(["normal"]);
    stop();
    savePrefs({ streamSpeed: "fast" });
    expect(seen).toEqual(["normal"]);
  });

  it("persists the completion chime toggle", () => {
    savePrefs({ soundEnabled: false });
    expect(loadPrefs().soundEnabled).toBe(false);
  });
});
