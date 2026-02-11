/**
 * Tests for workspace handlers (workspace/search, workspace/list, workspace/read)
 *
 * Follows the same pattern as server-credentials.test.ts:
 * - Mock service dependencies with vi.fn()
 * - Create minimal HandlerContext
 * - Test parameter validation and service delegation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWorkspaceHandlers } from "../server/workspace";
import type { WorkspaceFileService, FileResult, FileContent } from "../server/workspace/types";
import type { HandlerContext, ServerSession } from "../server/types";

// =============================================================================
// Test helpers
// =============================================================================

function createMockFileService(
  overrides?: Partial<WorkspaceFileService>,
): WorkspaceFileService {
  return {
    search: vi.fn().mockResolvedValue([
      { path: "src/index.ts", isDirectory: false, size: 150, mime: "text/typescript" },
      { path: "src/app.tsx", isDirectory: false, size: 340, mime: "text/tsx" },
    ] satisfies FileResult[]),
    list: vi.fn().mockResolvedValue([
      { path: "src", isDirectory: true },
      { path: "package.json", isDirectory: false, size: 800, mime: "application/json" },
    ] satisfies FileResult[]),
    read: vi.fn().mockResolvedValue({
      text: 'export const foo = 123;\n',
      mime: "text/typescript",
      size: 24,
    } satisfies FileContent),
    ...overrides,
  };
}

function createHandlerContext(): HandlerContext {
  return {
    session: { id: "session-1", role: "agent" } as unknown as ServerSession,
    requestId: "req-1",
    signal: new AbortController().signal,
  };
}

// =============================================================================
// workspace/search tests
// =============================================================================

describe("workspace/search handler", () => {
  let fileService: WorkspaceFileService;

  beforeEach(() => {
    fileService = createMockFileService();
  });

  it("should return search results from file service", async () => {
    const handlers = createWorkspaceHandlers({ fileService });
    const ctx = createHandlerContext();

    const result = (await handlers["workspace/search"](
      { agentId: "agent-1", query: "*.ts" },
      ctx,
    )) as { files: FileResult[] };

    expect(result.files).toHaveLength(2);
    expect(result.files[0].path).toBe("src/index.ts");
    expect(result.files[1].path).toBe("src/app.tsx");
  });

  it("should pass cwd and limit options to service", async () => {
    const handlers = createWorkspaceHandlers({ fileService });
    const ctx = createHandlerContext();

    await handlers["workspace/search"](
      { agentId: "agent-1", query: "*.ts", cwd: "src", limit: 10 },
      ctx,
    );

    expect(fileService.search).toHaveBeenCalledWith("agent-1", "*.ts", {
      cwd: "src",
      limit: 10,
    });
  });

  it("should throw when agentId is missing", async () => {
    const handlers = createWorkspaceHandlers({ fileService });
    const ctx = createHandlerContext();

    await expect(
      handlers["workspace/search"]({ query: "*.ts" }, ctx),
    ).rejects.toThrow("Missing required parameter: agentId");

    expect(fileService.search).not.toHaveBeenCalled();
  });

  it("should throw when query is missing", async () => {
    const handlers = createWorkspaceHandlers({ fileService });
    const ctx = createHandlerContext();

    await expect(
      handlers["workspace/search"]({ agentId: "agent-1" }, ctx),
    ).rejects.toThrow("Missing required parameter: query");

    expect(fileService.search).not.toHaveBeenCalled();
  });

  it("should handle empty search results", async () => {
    const emptyService = createMockFileService({
      search: vi.fn().mockResolvedValue([]),
    });
    const handlers = createWorkspaceHandlers({ fileService: emptyService });
    const ctx = createHandlerContext();

    const result = (await handlers["workspace/search"](
      { agentId: "agent-1", query: "nonexistent" },
      ctx,
    )) as { files: FileResult[] };

    expect(result.files).toEqual([]);
  });

  it("should propagate service errors", async () => {
    const errorService = createMockFileService({
      search: vi.fn().mockRejectedValue(new Error("Permission denied")),
    });
    const handlers = createWorkspaceHandlers({ fileService: errorService });
    const ctx = createHandlerContext();

    await expect(
      handlers["workspace/search"](
        { agentId: "agent-1", query: "*.ts" },
        ctx,
      ),
    ).rejects.toThrow("Permission denied");
  });
});

// =============================================================================
// workspace/list tests
// =============================================================================

describe("workspace/list handler", () => {
  let fileService: WorkspaceFileService;

  beforeEach(() => {
    fileService = createMockFileService();
  });

  it("should return file listing from service", async () => {
    const handlers = createWorkspaceHandlers({ fileService });
    const ctx = createHandlerContext();

    const result = (await handlers["workspace/list"](
      { agentId: "agent-1" },
      ctx,
    )) as { files: FileResult[] };

    expect(result.files).toHaveLength(2);
    expect(result.files[0].path).toBe("src");
    expect(result.files[0].isDirectory).toBe(true);
  });

  it("should pass optional directory parameter", async () => {
    const handlers = createWorkspaceHandlers({ fileService });
    const ctx = createHandlerContext();

    await handlers["workspace/list"](
      { agentId: "agent-1", directory: "src/components" },
      ctx,
    );

    expect(fileService.list).toHaveBeenCalledWith("agent-1", "src/components");
  });

  it("should throw when agentId is missing", async () => {
    const handlers = createWorkspaceHandlers({ fileService });
    const ctx = createHandlerContext();

    await expect(
      handlers["workspace/list"]({}, ctx),
    ).rejects.toThrow("Missing required parameter: agentId");

    expect(fileService.list).not.toHaveBeenCalled();
  });

  it("should handle null params gracefully", async () => {
    const handlers = createWorkspaceHandlers({ fileService });
    const ctx = createHandlerContext();

    await expect(
      handlers["workspace/list"](null, ctx),
    ).rejects.toThrow("Missing required parameter: agentId");
  });
});

// =============================================================================
// workspace/read tests
// =============================================================================

describe("workspace/read handler", () => {
  let fileService: WorkspaceFileService;

  beforeEach(() => {
    fileService = createMockFileService();
  });

  it("should return file content from service", async () => {
    const handlers = createWorkspaceHandlers({ fileService });
    const ctx = createHandlerContext();

    const result = (await handlers["workspace/read"](
      { agentId: "agent-1", path: "src/index.ts" },
      ctx,
    )) as FileContent;

    expect(result.text).toBe('export const foo = 123;\n');
    expect(result.mime).toBe("text/typescript");
    expect(result.size).toBe(24);
  });

  it("should pass optional lineRange through to service", async () => {
    const handlers = createWorkspaceHandlers({ fileService });
    const ctx = createHandlerContext();

    const lineRange = { start: 10, end: 20 };
    await handlers["workspace/read"](
      { agentId: "agent-1", path: "src/index.ts", lineRange },
      ctx,
    );

    expect(fileService.read).toHaveBeenCalledWith("agent-1", "src/index.ts", lineRange);
  });

  it("should throw when agentId is missing", async () => {
    const handlers = createWorkspaceHandlers({ fileService });
    const ctx = createHandlerContext();

    await expect(
      handlers["workspace/read"]({ path: "src/index.ts" }, ctx),
    ).rejects.toThrow("Missing required parameter: agentId");

    expect(fileService.read).not.toHaveBeenCalled();
  });

  it("should throw when path is missing", async () => {
    const handlers = createWorkspaceHandlers({ fileService });
    const ctx = createHandlerContext();

    await expect(
      handlers["workspace/read"]({ agentId: "agent-1" }, ctx),
    ).rejects.toThrow("Missing required parameter: path");

    expect(fileService.read).not.toHaveBeenCalled();
  });

  it("should propagate service error on unreadable file", async () => {
    const errorService = createMockFileService({
      read: vi.fn().mockRejectedValue(new Error("File not found: missing.ts")),
    });
    const handlers = createWorkspaceHandlers({ fileService: errorService });
    const ctx = createHandlerContext();

    await expect(
      handlers["workspace/read"](
        { agentId: "agent-1", path: "missing.ts" },
        ctx,
      ),
    ).rejects.toThrow("File not found: missing.ts");
  });
});
