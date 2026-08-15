import { constants } from "node:fs";
import { mkdir, open, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AdapterContext, AgentHomeStore, PortableFile } from "@cowork/adapter-kit";

export class LocalAgentHomeStore implements AgentHomeStore {
  constructor(private readonly root: string) {}

  describe() {
    return {
      id: "local-fs",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { revisions: true },
    };
  }

  private botDir(botId: string) {
    if (!botId || botId === "." || botId === ".." || path.basename(botId) !== botId) {
      throw new Error("Invalid bot id");
    }
    return path.join(this.root, "homes", botId);
  }

  pathFor(botId: string) {
    return path.resolve(this.botDir(botId));
  }

  async checkout(botId: string, dest: string, _context: AdapterContext): Promise<string> {
    await mkdir(dest, { recursive: true });
    const src = this.botDir(botId);
    await mkdir(src, { recursive: true });
    await copyDir(src, dest);
    return "working";
  }

  async commit(botId: string, src: string, _context: AdapterContext): Promise<string> {
    const dest = this.botDir(botId);
    await rm(dest, { recursive: true, force: true });
    await mkdir(dest, { recursive: true });
    await copyDir(src, dest);
    const revision = `rev-${Date.now()}`;
    await writeFile(path.join(dest, ".revision"), revision, "utf8");
    return revision;
  }

  async restore(
    botId: string,
    _revision: string,
    dest: string,
    context: AdapterContext,
  ): Promise<void> {
    await this.checkout(botId, dest, context);
  }

  async *exportHome(botId: string, _context: AdapterContext): AsyncIterable<PortableFile> {
    const dir = this.botDir(botId);
    await mkdir(dir, { recursive: true });
    yield* walkFiles(dir, dir);
  }

  async readFile(botId: string, filePath: string, _context: AdapterContext): Promise<string> {
    const full = await containedExistingPath(this.botDir(botId), filePath);
    const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      return await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  }

  async writeFile(
    botId: string,
    filePath: string,
    content: string,
    _context: AdapterContext,
  ): Promise<void> {
    const full = await containedWritePath(this.botDir(botId), filePath);
    const handle = await open(
      full,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      0o666,
    );
    try {
      await handle.writeFile(content, "utf8");
    } finally {
      await handle.close();
    }
  }

  async list(botId: string, dirPath: string, _context: AdapterContext) {
    const root = this.botDir(botId);
    const candidate = safeJoin(root, dirPath);
    const full = await ensureContainedDirectory(root, candidate);
    const entries = await readdir(full, { withFileTypes: true });
    const listed = await Promise.all(
      entries.map(async (entry) => {
        const child = await containedTarget(root, path.join(full, entry.name)).catch(() => null);
        if (!child) return null;
        const info = await stat(child);
        return {
          path: path.posix.join(dirPath.replace(/\\/g, "/"), entry.name),
          kind: info.isDirectory() ? ("dir" as const) : ("file" as const),
          size: info.size,
        };
      }),
    );
    return listed.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }
}

export function resolveAgentHomePath(home: AgentHomeStore, botId: string, dataDir = "./data") {
  if (home instanceof LocalAgentHomeStore) return home.pathFor(botId);
  return path.resolve(dataDir, "homes", botId);
}

function safeJoin(root: string, rel: string) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, `.${path.sep}${rel.replace(/^\/+/, "")}`);
  assertContained(resolvedRoot, resolved);
  return resolved;
}

async function containedExistingPath(root: string, rel: string) {
  await mkdir(root, { recursive: true });
  const candidate = safeJoin(root, rel);
  return containedTarget(root, candidate);
}

async function containedWritePath(root: string, rel: string) {
  await mkdir(root, { recursive: true });
  const candidate = safeJoin(root, rel);
  const resolvedParent = await ensureContainedDirectory(root, path.dirname(candidate));
  try {
    return await containedTarget(root, path.join(resolvedParent, path.basename(candidate)));
  } catch (error) {
    if (isMissing(error)) return path.join(resolvedParent, path.basename(candidate));
    throw error;
  }
}

async function ensureContainedDirectory(root: string, candidate: string) {
  await mkdir(root, { recursive: true });
  const lexicalRoot = path.resolve(root);
  const lexicalCandidate = path.resolve(candidate);
  assertContained(lexicalRoot, lexicalCandidate);
  const resolvedRoot = await realpath(root);
  const relative = path.relative(lexicalRoot, lexicalCandidate);
  let current = resolvedRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    const next = path.join(current, segment);
    try {
      current = await realpath(next);
    } catch (error) {
      if (!isMissing(error)) throw error;
      await mkdir(next);
      current = await realpath(next);
    }
    assertContained(resolvedRoot, current);
    if (!(await stat(current)).isDirectory()) throw new Error("Path component is not a directory");
  }
  return current;
}

async function containedTarget(root: string, candidate: string) {
  const [resolvedRoot, resolvedTarget] = await Promise.all([realpath(root), realpath(candidate)]);
  assertContained(resolvedRoot, resolvedTarget);
  return resolvedTarget;
}

function assertContained(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..")) return;
  throw new Error("Path escapes the bot home");
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function copyDir(src: string, dest: string, sourceRoot = src, visited = new Set<string>()) {
  await mkdir(dest, { recursive: true });
  const current = await containedTarget(sourceRoot, src).catch(() => null);
  if (!current || visited.has(current)) return;
  visited.add(current);
  const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const from = await containedTarget(sourceRoot, path.join(current, entry.name)).catch(
      () => null,
    );
    if (!from) continue;
    const to = path.join(dest, entry.name);
    const info = await stat(from);
    if (info.isDirectory()) await copyDir(from, to, sourceRoot, visited);
    else if (info.isFile()) await writeFile(to, await readFile(from));
  }
}

async function* walkFiles(
  root: string,
  current: string,
  outputPath = "",
  visited = new Set<string>(),
): AsyncGenerator<PortableFile> {
  const resolvedCurrent = await containedTarget(root, current).catch(() => null);
  if (!resolvedCurrent || visited.has(resolvedCurrent)) return;
  visited.add(resolvedCurrent);
  const entries = await readdir(resolvedCurrent, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = await containedTarget(root, path.join(resolvedCurrent, entry.name)).catch(
      () => null,
    );
    if (!full) continue;
    const info = await stat(full);
    const portablePath = path.posix.join(outputPath, entry.name);
    if (info.isDirectory()) {
      yield* walkFiles(root, full, portablePath, visited);
    } else if (info.isFile()) {
      const content = await readFile(full);
      yield {
        path: portablePath,
        content: new Uint8Array(content),
      };
    }
  }
}
