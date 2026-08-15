import type {
  AdapterContext,
  MemoryCommitRequest,
  MemoryExportRequest,
  MemoryReadRequest,
  MemoryRevision,
  MemorySearchRequest,
  MemorySearchResult,
  MemorySnapshot,
  MemoryStore,
  PortableFile,
} from "@cowork/adapter-kit";
import type { PrismaClient } from "@cowork/db";

export class MarkdownMemoryStore implements MemoryStore {
  constructor(private readonly prisma: PrismaClient) {}

  describe() {
    return {
      id: "markdown",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { search: true, revisions: true, markdownPortable: true },
    };
  }

  async read(request: MemoryReadRequest, context: AdapterContext): Promise<MemorySnapshot> {
    const documents = await this.prisma.memoryDocument.findMany({
      where: {
        workspaceId: context.workspaceId,
        userId: context.userId,
        scope: request.scope,
        ...(request.botId ? { botId: request.botId } : {}),
        ...(request.path ? { path: request.path } : {}),
      },
    });
    return {
      documents: documents.map((doc) => ({
        id: doc.id,
        path: doc.path,
        content: doc.content,
        revision: doc.revision,
      })),
    };
  }

  async search(
    request: MemorySearchRequest,
    context: AdapterContext,
  ): Promise<MemorySearchResult[]> {
    const documents = await this.prisma.memoryDocument.findMany({
      where: {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ...(request.scope === "all" ? {} : { scope: request.scope }),
        ...(request.botId ? { botId: request.botId } : {}),
      },
    });
    const q = request.query.toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    return documents
      .map((doc) => {
        const hay = `${doc.path}\n${doc.content}`.toLowerCase();
        if (!terms.some((term) => hay.includes(term))) return null;
        const hits = terms.reduce((n, term) => n + countOccurrences(hay, term), 0);
        const pathBoost = doc.path.toLowerCase().includes(q) ? 0.25 : 0;
        return {
          path: doc.path,
          snippet: snippet(doc.content, q),
          score: Math.min(1, pathBoost + hits / Math.max(8, terms.length * 2)),
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => b.score - a.score);
  }

  async commit(request: MemoryCommitRequest, context: AdapterContext): Promise<MemoryRevision> {
    const existing = await this.prisma.memoryDocument.findFirst({
      where: {
        workspaceId: context.workspaceId,
        userId: context.userId,
        scope: request.scope,
        botId: request.botId ?? null,
        path: request.path,
      },
    });
    const doc = existing
      ? await this.prisma.memoryDocument.update({
          where: { id: existing.id },
          data: { content: request.content, revision: existing.revision + 1 },
        })
      : await this.prisma.memoryDocument.create({
          data: {
            workspaceId: context.workspaceId,
            userId: context.userId,
            botId: request.botId,
            scope: request.scope,
            path: request.path,
            content: request.content,
          },
        });
    await this.prisma.memoryRevision.create({
      data: {
        documentId: doc.id,
        revision: doc.revision,
        content: request.content,
        sourceRunId: request.sourceRunId,
        sourceThreadId: request.sourceThreadId,
      },
    });
    return { id: doc.id, path: doc.path, revision: doc.revision, content: doc.content };
  }

  async *exportMarkdown(
    request: MemoryExportRequest,
    context: AdapterContext,
  ): AsyncIterable<PortableFile> {
    const snapshot = await this.read(
      { scope: request.scope === "all" ? "user" : request.scope, botId: request.botId },
      context,
    );
    for (const doc of snapshot.documents) {
      yield { path: doc.path, content: new TextEncoder().encode(doc.content) };
    }
  }

  async importMarkdown(
    files: AsyncIterable<PortableFile>,
    context: AdapterContext,
  ): Promise<MemoryRevision> {
    let last: MemoryRevision | undefined;
    for await (const file of files) {
      last = await this.commit(
        {
          scope: "user",
          path: file.path,
          content: new TextDecoder().decode(file.content),
        },
        context,
      );
    }
    if (!last) throw new Error("No memory files to import");
    return last;
  }
}

function snippet(content: string, q: string): string {
  const idx = content.toLowerCase().indexOf(q);
  if (idx < 0) return content.slice(0, 140);
  return content.slice(Math.max(0, idx - 40), idx + q.length + 80);
}

function countOccurrences(hay: string, needle: string) {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (from <= hay.length) {
    const idx = hay.indexOf(needle, from);
    if (idx < 0) break;
    count += 1;
    from = idx + needle.length;
  }
  return count;
}
