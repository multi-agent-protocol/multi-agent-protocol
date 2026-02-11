/**
 * Workspace module types.
 *
 * Service interfaces for workspace file access, injected into handler factories.
 */

import type { AgentId } from "../../types";

/**
 * A single file search/list result.
 */
export interface FileResult {
  /** Relative path from workspace root */
  path: string;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** File size in bytes (undefined for directories) */
  size?: number;
  /** MIME type guess based on extension */
  mime?: string;
}

/**
 * Result of reading a file.
 */
export interface FileContent {
  /** File text content */
  text: string;
  /** MIME type */
  mime: string;
  /** File size in bytes */
  size: number;
}

/**
 * Service interface for workspace file operations.
 *
 * Implementations handle the actual filesystem access,
 * including security (path traversal prevention) and
 * workspace resolution per agent.
 */
export interface WorkspaceFileService {
  /**
   * Search for files matching a query within an agent's workspace.
   *
   * @param agentId - Agent whose workspace to search
   * @param query - Search query (matched against filenames)
   * @param options - Optional search parameters
   * @returns Array of matching file results
   */
  search(
    agentId: AgentId,
    query: string,
    options?: { cwd?: string; limit?: number },
  ): Promise<FileResult[]>;

  /**
   * List files in a directory within an agent's workspace.
   *
   * @param agentId - Agent whose workspace to list
   * @param directory - Directory relative to workspace root (default ".")
   * @returns Array of file results
   */
  list(agentId: AgentId, directory?: string): Promise<FileResult[]>;

  /**
   * Read file contents from an agent's workspace.
   *
   * @param agentId - Agent whose workspace to read from
   * @param path - File path relative to workspace root
   * @param lineRange - Optional line range (1-indexed)
   * @returns File content with metadata
   */
  read(
    agentId: AgentId,
    path: string,
    lineRange?: { start: number; end: number },
  ): Promise<FileContent>;
}

/**
 * Workspace capability configuration for the server.
 * When provided, workspace capabilities are included in the connect response.
 */
export interface WorkspaceCapabilityConfig {
  /** Whether workspace is enabled on this server */
  enabled: boolean;
  /** Can search files (default: true) */
  canSearch?: boolean;
  /** Can list files in directories (default: true) */
  canList?: boolean;
  /** Can read file contents (default: true) */
  canRead?: boolean;
}
