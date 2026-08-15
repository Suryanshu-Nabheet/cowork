import { describe, expect, it } from "vitest";
import { confirmSpawnedBotName } from "./child-bots.js";

describe("spawned bot deletion", () => {
  it("refuses when confirm_name does not match exactly", () => {
    expect(confirmSpawnedBotName("scout", "Scout")).toMatchObject({ ok: false });
    expect(confirmSpawnedBotName("Scout ", "Scout")).toMatchObject({ ok: false });
  });

  it("accepts an exact name match", () => {
    expect(confirmSpawnedBotName("Scout", "Scout")).toEqual({ ok: true });
  });
});
