import { describe, expect, it } from "vitest";
import { browserWindowOptions } from "./window-options.js";

describe("desktop window chrome", () => {
  it("uses native traffic lights on macOS", () => {
    const opts = browserWindowOptions("darwin");
    expect(opts.frame).toBe(true);
    expect(opts.titleBarStyle).toBe("hiddenInset");
    expect(opts.trafficLightPosition).toEqual({ x: 16, y: 16 });
  });

  it("is frameless on Windows and Linux so in-app buttons control the window", () => {
    for (const platform of ["win32", "linux"] as const) {
      const opts = browserWindowOptions(platform);
      expect(opts.frame).toBe(false);
      expect(opts.titleBarStyle).toBeUndefined();
    }
  });
});
