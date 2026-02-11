/**
 * Workspace module - File search, listing, and read operations
 *
 * Provides workspace file access as MAP protocol methods.
 */

// Types
export type {
  WorkspaceFileService,
  WorkspaceCapabilityConfig,
  FileResult,
  FileContent,
} from "./types";

// Handler factory
export { createWorkspaceHandlers, type WorkspaceHandlerOptions } from "./handlers";
