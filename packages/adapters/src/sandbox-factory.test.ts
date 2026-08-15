import { describe, expect, it } from "vitest";
import { createSandboxProvider } from "./sandbox-factory.js";

describe("createSandboxProvider", () => {
  it("returns fake sandbox when explicitly requested", () => {
    const sandbox = createSandboxProvider("fake", {});
    expect(sandbox.describe().id).toBe("fake");
  });

  it("throws on unknown provider", () => {
    expect(() => createSandboxProvider("bogus", {})).toThrow(
      'Unknown SANDBOX_PROVIDER "bogus". Use docker | e2b | e2b-emulator | desktop | fake.',
    );
  });
});
