import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSupervisorToken } from "@cowork/core";
import { loadRootEnv } from "@cowork/core/load-root-env";
import { serve } from "@hono/node-server";
import Docker from "dockerode";
import { Hono } from "hono";
import { z } from "zod";
import {
  COMPUTER_IMAGE,
  containerCreateOptions,
  containerNameFor,
  type SandboxInput,
  screenUrlFor,
  xdotoolCommand,
} from "./computer-spec.js";

loadRootEnv();

function resolveDockerSocket(): string {
  if (process.env.DOCKER_SOCKET) return process.env.DOCKER_SOCKET;
  if (existsSync("/var/run/docker.sock")) return "/var/run/docker.sock";
  const homeColima = path.join(process.env.HOME ?? "", ".colima/default/docker.sock");
  if (existsSync(homeColima)) return homeColima;
  const colimaAlt = path.join(process.env.HOME ?? "", ".colima/docker.sock");
  if (existsSync(colimaAlt)) return colimaAlt;
  return "/var/run/docker.sock";
}

const docker = new Docker({ socketPath: resolveDockerSocket() });
const computerContext =
  process.env.COWORK_COMPUTER_CONTEXT ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../computer");
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const dataDir = path.resolve(repositoryRoot, process.env.DATA_DIR ?? "./data");
const boxes = new Map<string, { containerId: string; botId: string; screenUrl: string }>();
let imageReady: Promise<void> | undefined;
let supervisorInfo: Docker.ContainerInspectInfo | undefined;
const supervisorToken = resolveSupervisorToken(process.env);

function reqBotId(c: { req: { header: (name: string) => string | undefined } }) {
  return c.req.header("x-cowork-bot-id");
}

function reqWorkspaceId(c: { req: { header: (name: string) => string | undefined } }) {
  return c.req.header("x-cowork-workspace-id");
}

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, image: COMPUTER_IMAGE }));

app.use("/computers", async (c, next) => {
  if (!hasValidSupervisorToken(c.req.header("authorization"))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});
app.use("/computers/*", async (c, next) => {
  if (!hasValidSupervisorToken(c.req.header("authorization"))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

app.post("/computers", async (c) => {
  const body = z
    .object({
      botId: z.string().min(1),
      homePath: z.string().min(1),
      workspaceId: z.string().min(1),
    })
    .parse(await c.req.json());
  try {
    assertRequestIdentity(reqBotId(c), reqWorkspaceId(c), {
      botId: body.botId,
      workspaceId: body.workspaceId,
    });
    await ensureComputerImage();
    const runtimeInfo = await inspectSupervisorContainer();
    const networkMode = computerNetworkMode(runtimeInfo);
    const serviceHomePath = path.resolve(body.homePath);
    assertBotHomePath(serviceHomePath, body.botId);
    await mkdir(serviceHomePath, { recursive: true });
    const homePath = hostHomePath(serviceHomePath, runtimeInfo);
    const existing = await findBotContainer(body.botId, body.workspaceId);
    if (existing) {
      const info = await existing.inspect();
      const desired = await docker.getImage(COMPUTER_IMAGE).inspect();
      if (
        info.Image !== desired.Id ||
        (networkMode && info.HostConfig.NetworkMode !== networkMode)
      ) {
        await existing.remove({ force: true }).catch(() => undefined);
        boxes.delete(existing.id);
      } else {
        if (!info.State.Running) await existing.start();
        const screenUrl = await publishedScreenUrl(existing, info.State.Running ? info : undefined);
        boxes.set(existing.id, { containerId: existing.id, botId: body.botId, screenUrl });
        return c.json({ id: existing.id, image: COMPUTER_IMAGE, screenUrl, resumed: true });
      }
    }
    const name = containerNameFor(body.botId);
    const container = await docker.createContainer(
      containerCreateOptions({
        name,
        image: COMPUTER_IMAGE,
        botId: body.botId,
        workspaceId: body.workspaceId,
        homePath,
        networkMode,
      }),
    );
    await container.start();
    const screenUrl = await publishedScreenUrl(container);
    boxes.set(container.id, { containerId: container.id, botId: body.botId, screenUrl });
    return c.json({ id: container.id, image: COMPUTER_IMAGE, screenUrl, resumed: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 500);
  }
});

app.get("/computers/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const { container, info } = await managedContainer(id, reqBotId(c), reqWorkspaceId(c));
    const screenUrl = await publishedScreenUrl(container, info);
    return c.json({
      id,
      running: Boolean(info.State.Running),
      image: info.Config.Image,
      screenUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 404);
  }
});

app.post("/computers/:id/exec", async (c) => {
  const id = c.req.param("id");
  const body = z
    .object({
      argv: z.array(z.string()),
      cwd: z.string().optional(),
      env: z.record(z.string(), z.string()).optional(),
    })
    .parse(await c.req.json());
  try {
    const { container } = await managedContainer(id, reqBotId(c), reqWorkspaceId(c));
    const exec = await container.exec({
      Cmd: body.argv.length ? body.argv : ["/bin/echo", "ready"],
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: body.cwd ?? "/home/cowork",
      Env: [
        "DISPLAY=:1",
        "HOME=/home/cowork",
        "PATH=/home/cowork/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "NPM_CONFIG_PREFIX=/home/cowork/.local",
        "PIP_USER=1",
        ...Object.entries(body.env ?? {}).map(([k, v]) => `${k}=${v}`),
      ],
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (d: Buffer) => chunks.push(d));
      stream.on("end", () => resolve());
      stream.on("error", reject);
    });
    const inspect = await exec.inspect();
    return c.json({
      stdout: stripDockerStream(Buffer.concat(chunks)),
      stderr: "",
      code: inspect.ExitCode ?? 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ stdout: "", stderr: message, code: 1 }, 200);
  }
});

app.get("/computers/:id/screen", async (c) => {
  const id = c.req.param("id");
  try {
    const { container, info } = await managedContainer(id, reqBotId(c), reqWorkspaceId(c));
    const screenUrl = await publishedScreenUrl(container, info);
    return c.redirect(screenUrl);
  } catch {
    return c.json({ error: "computer not found" }, 404);
  }
});

app.post("/computers/:id/input", async (c) => {
  const id = c.req.param("id");
  const body = z
    .object({
      input: z.object({
        kind: z.enum(["key", "pointer", "clipboard"]),
        key: z.string().optional(),
        modifiers: z.array(z.string()).optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        button: z.enum(["left", "right"]).optional(),
        type: z.enum(["move", "down", "up", "click"]).optional(),
        text: z.string().optional(),
      }),
      leaseId: z.string().optional(),
    })
    .parse(await c.req.json());
  const input = toSandboxInput(body.input);
  try {
    const { container } = await managedContainer(id, reqBotId(c), reqWorkspaceId(c));
    const exec = await container.exec({
      Cmd: ["env", "DISPLAY=:1", ...xdotoolCommand(input)],
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: "/home/cowork",
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    await new Promise<void>((resolve, reject) => {
      stream.on("end", () => resolve());
      stream.on("error", reject);
      stream.resume();
    });
    const inspect = await exec.inspect();
    if ((inspect.ExitCode ?? 0) !== 0) {
      return c.json({ ok: false, error: "input failed" }, 500);
    }
    return c.json({ ok: true, leaseId: body.leaseId ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ ok: false, error: message }, 500);
  }
});

app.post("/computers/:id/stop", async (c) => {
  try {
    const { container } = await managedContainer(c.req.param("id"), reqBotId(c), reqWorkspaceId(c));
    await container.stop().catch(() => undefined);
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "computer not found" }, 404);
  }
});

app.delete("/computers/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const { container } = await managedContainer(id, reqBotId(c), reqWorkspaceId(c));
    await container.remove({ force: true }).catch(() => undefined);
    boxes.delete(id);
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "computer not found" }, 404);
  }
});

const port = Number(process.env.SUPERVISOR_PORT ?? 7091);
const hostname = process.env.SUPERVISOR_HOST ?? "127.0.0.1";
serve({ fetch: app.fetch, hostname, port }, () => {
  console.log(`sandbox supervisor on http://${hostname}:${port}`);
});

async function ensureComputerImage() {
  if (!imageReady) {
    imageReady = (async () => {
      try {
        await docker.getImage(COMPUTER_IMAGE).inspect();
        return;
      } catch {
        // build below
      }
      const dockerfile = path.join(computerContext, "Dockerfile");
      if (!existsSync(dockerfile)) {
        throw new Error(
          `Missing ${COMPUTER_IMAGE}. Build it with: docker build -t ${COMPUTER_IMAGE} infra/sandboxes/computer`,
        );
      }
      const stream = await docker.buildImage(
        {
          context: computerContext,
          src: [
            "Dockerfile",
            "start.sh",
            "cowork-browser",
            "embed.html",
            "fluxbox.init",
            "fluxbox.apps",
            "fluxbox.menu",
          ].filter((f) => existsSync(path.join(computerContext, f))),
        },
        { t: COMPUTER_IMAGE },
      );
      await new Promise<void>((resolve, reject) => {
        docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve()));
      });
      await docker.getImage(COMPUTER_IMAGE).inspect();
    })();
  }
  await imageReady;
}

async function findBotContainer(botId: string, workspaceId: string) {
  const listed = await docker.listContainers({
    all: true,
    filters: {
      label: [`cowork.botId=${botId}`, `cowork.workspaceId=${workspaceId}`],
    },
  });
  for (const item of listed) {
    const container = docker.getContainer(item.Id);
    const info = await container.inspect();
    if (isCoworkContainer(info, botId, workspaceId)) return container;
  }
  return undefined;
}

async function managedContainer(id: string, botId?: string, workspaceId?: string) {
  if (!botId || !workspaceId) throw new Error("missing computer identity");
  const container = docker.getContainer(id);
  const info = await container.inspect();
  if (!isCoworkContainer(info, botId, workspaceId)) throw new Error("computer identity mismatch");
  return { container, info };
}

function isCoworkContainer(info: Docker.ContainerInspectInfo, botId: string, workspaceId: string) {
  const labels = info.Config.Labels ?? {};
  const managed = labels["cowork.managed"] === "true" || info.Config.Image === COMPUTER_IMAGE;
  const matchBot = labels["cowork.botId"] === botId;
  const matchWorkspace = labels["cowork.workspaceId"] === workspaceId;
  return managed && matchBot && matchWorkspace;
}

function assertRequestIdentity(
  botId: string | undefined,
  workspaceId: string | undefined,
  expected: { botId: string; workspaceId: string },
) {
  if (botId !== expected.botId || workspaceId !== expected.workspaceId) {
    throw new Error("computer identity mismatch");
  }
}

function assertBotHomePath(homePath: string, botId: string) {
  const expected = path.join(dataDir, "homes", botId);
  if (homePath !== expected) {
    throw new Error("computer home must be the bot's home directory");
  }
}

function hostHomePath(
  serviceHomePath: string,
  runtimeInfo: Docker.ContainerInspectInfo | undefined,
): string {
  if (!runtimeInfo) return serviceHomePath;
  for (const mount of runtimeInfo.Mounts ?? []) {
    if (mount.Destination === "/data" && mount.Source) {
      return path.join(mount.Source, path.relative("/data", serviceHomePath));
    }
  }
  return serviceHomePath;
}

async function inspectSupervisorContainer(): Promise<Docker.ContainerInspectInfo | undefined> {
  if (supervisorInfo) return supervisorInfo;
  const containerId = supervisorContainerId();
  if (!containerId) return undefined;
  try {
    supervisorInfo = await docker.getContainer(containerId).inspect();
    return supervisorInfo;
  } catch {
    return undefined;
  }
}

function supervisorContainerId(): string | undefined {
  const envId = process.env.SUPERVISOR_CONTAINER_ID ?? process.env.HOSTNAME;
  if (envId && /^[a-zA-Z0-9]{12,64}$/.test(envId)) return envId;
  return undefined;
}

function computerNetworkMode(runtimeInfo: Docker.ContainerInspectInfo | undefined) {
  if (!runtimeInfo) return undefined;
  const name = runtimeInfo.HostConfig.NetworkMode;
  if (name && name !== "default" && name !== "bridge" && name !== "host") {
    return name;
  }
  const networks = Object.keys(runtimeInfo.NetworkSettings.Networks ?? {});
  return networks[0];
}

async function publishedScreenUrl(
  container: Docker.Container,
  info?: Docker.ContainerInspectInfo,
): Promise<string> {
  const inspect = info ?? (await container.inspect());
  const screenNet = process.env.SANDBOX_SCREEN_NETWORK;
  if (screenNet === "internal") {
    const ip =
      inspect.NetworkSettings.IPAddress || inspect.NetworkSettings.Networks[screenNet]?.IPAddress;
    return `http://${ip || inspect.Config.Hostname}:6080/embed.html`;
  }
  const ports = inspect.NetworkSettings.Ports["6080/tcp"];
  const hostPort = ports?.[0]?.HostPort ?? "6080";
  return screenUrlFor(hostPort);
}

function toSandboxInput(raw: {
  kind: "key" | "pointer" | "clipboard";
  key?: string;
  modifiers?: string[];
  x?: number;
  y?: number;
  button?: "left" | "right";
  type?: "move" | "down" | "up" | "click";
  text?: string;
}): SandboxInput {
  if (raw.kind === "key") return { kind: "key", key: raw.key ?? "", modifiers: raw.modifiers };
  if (raw.kind === "pointer") {
    return {
      kind: "pointer",
      x: Math.round(raw.x ?? 0),
      y: Math.round(raw.y ?? 0),
      button: raw.button,
      type: raw.type ?? "click",
    };
  }
  return { kind: "clipboard", text: raw.text ?? "" };
}

function hasValidSupervisorToken(header: string | undefined): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice(7).trim();
  const tokenBuf = Buffer.from(token);
  const supBuf = Buffer.from(supervisorToken);
  if (tokenBuf.length !== supBuf.length) return false;
  return timingSafeEqual(tokenBuf, supBuf);
}

function stripDockerStream(buf: Buffer): string {
  if (buf.length < 8) return buf.toString("utf8");
  const chunks: Buffer[] = [];
  let i = 0;
  while (i < buf.length) {
    if (i + 8 > buf.length) {
      chunks.push(buf.subarray(i));
      break;
    }
    const size = buf.readUInt32BE(i + 4);
    const start = i + 8;
    const end = Math.min(start + size, buf.length);
    chunks.push(buf.subarray(start, end));
    i = end;
  }
  return Buffer.concat(chunks).toString("utf8");
}
