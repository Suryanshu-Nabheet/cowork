import type { SandboxProvider } from "@cowork/adapter-kit";
import { DesktopSandboxProvider } from "./desktop-sandbox.js";
import { DockerSandboxProvider } from "./docker-sandbox.js";
import { ManagedSandboxEmulator } from "./e2b-emulator.js";
import { E2BSandboxProvider } from "./e2b-sandbox.js";
import { FakeSandboxProvider } from "./fake-sandbox.js";

export function createSandboxProvider(
  kind: string,
  opts: {
    supervisorUrl?: string;
    supervisorToken?: string;
    e2bApiKey?: string;
    dataDir?: string;
  },
): SandboxProvider {
  switch (kind) {
    case "e2b":
      if (!opts.e2bApiKey) throw new Error("E2B_API_KEY is required for the e2b sandbox provider");
      return new E2BSandboxProvider(opts.e2bApiKey);
    case "docker":
      return new DockerSandboxProvider(
        opts.supervisorUrl ?? "http://127.0.0.1:7091",
        opts.supervisorToken,
      );
    case "e2b-emulator":
      return new ManagedSandboxEmulator();
    case "desktop":
      return new DesktopSandboxProvider({
        root: opts.dataDir,
      });
    case "fake":
      return new FakeSandboxProvider();
    default:
      throw new Error(
        `Unknown SANDBOX_PROVIDER "${kind}". Use docker | e2b | e2b-emulator | desktop | fake.`,
      );
  }
}
