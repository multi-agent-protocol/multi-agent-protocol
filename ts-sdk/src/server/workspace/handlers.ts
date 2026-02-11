/**
 * Workspace handler factories
 *
 * Creates JSON-RPC handlers for workspace/* protocol methods.
 */

import type { HandlerContext, HandlerRegistry } from "../types";
import type {
  WorkspaceSearchRequestParams,
  WorkspaceListRequestParams,
  WorkspaceReadRequestParams,
} from "../../types";
import type { WorkspaceFileService } from "./types";

// =============================================================================
// Options
// =============================================================================

/**
 * Options for creating workspace handlers.
 */
export interface WorkspaceHandlerOptions {
  /** Workspace file service implementation */
  fileService: WorkspaceFileService;
}

// =============================================================================
// Handler Factory
// =============================================================================

/**
 * Create handlers for workspace/* protocol methods.
 *
 * Methods:
 * - `workspace/search` — Search for files matching a query
 * - `workspace/list` — List files in a directory
 * - `workspace/read` — Read file contents
 */
export function createWorkspaceHandlers(
  options: WorkspaceHandlerOptions,
): HandlerRegistry {
  const { fileService } = options;

  return {
    "workspace/search": async (params: unknown, _ctx: HandlerContext) => {
      const p = (params ?? {}) as Partial<WorkspaceSearchRequestParams>;

      if (!p.agentId || typeof p.agentId !== "string") {
        throw new Error("Missing required parameter: agentId");
      }
      if (!p.query || typeof p.query !== "string") {
        throw new Error("Missing required parameter: query");
      }

      const files = await fileService.search(p.agentId, p.query, {
        cwd: p.cwd,
        limit: p.limit,
      });

      return { files };
    },

    "workspace/list": async (params: unknown, _ctx: HandlerContext) => {
      const p = (params ?? {}) as Partial<WorkspaceListRequestParams>;

      if (!p.agentId || typeof p.agentId !== "string") {
        throw new Error("Missing required parameter: agentId");
      }

      const files = await fileService.list(p.agentId, p.directory);
      return { files };
    },

    "workspace/read": async (params: unknown, _ctx: HandlerContext) => {
      const p = (params ?? {}) as Partial<WorkspaceReadRequestParams>;

      if (!p.agentId || typeof p.agentId !== "string") {
        throw new Error("Missing required parameter: agentId");
      }
      if (!p.path || typeof p.path !== "string") {
        throw new Error("Missing required parameter: path");
      }

      const result = await fileService.read(p.agentId, p.path, p.lineRange);
      return result;
    },
  };
}
