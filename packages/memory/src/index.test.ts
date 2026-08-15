import { describe, expect, it } from "vitest";
import { MarkdownMemoryStore } from "./index.js";

describe("memory store contract shape", () => {
  it("declares markdown portability", () => {
    const store = new MarkdownMemoryStore({} as never);
    expect(store.describe().capabilities.markdownPortable).toBe(true);
  });
});
