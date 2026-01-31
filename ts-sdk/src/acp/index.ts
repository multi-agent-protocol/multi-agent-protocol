/**
 * ACP (Agent Client Protocol) over MAP tunneling support.
 *
 * This module provides types, classes, and utilities for tunneling ACP messages
 * through MAP, enabling clients to interact with ACP-compatible agents
 * within a MAP system while preserving all ACP semantics.
 *
 * @module
 */

// Types
export * from "./types";

// Client-side stream connection
export {
  ACPStreamConnection,
  createACPStream,
  type ACPStreamOptions,
  type ACPStreamEvents,
} from "./stream";

// Agent-side adapter
export { ACPAgentAdapter } from "./adapter";
