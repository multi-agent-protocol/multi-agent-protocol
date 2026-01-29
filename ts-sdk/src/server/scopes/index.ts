/**
 * Scope system - ScopeManager and ScopeStore implementations with hierarchy
 */

// Re-export types
export type {
  ServerScope,
  ScopeFilter,
  ScopeStore,
  ScopeManager,
  ScopeManagerOptions,
} from "../types";

// Implementations
export {
  ScopeManagerImpl,
  ScopeNotFoundError,
  InvalidParentScopeError,
} from "./manager";
export { InMemoryScopeStore } from "./stores/in-memory";

// Handlers
export { createScopeHandlers, type ScopeHandlerOptions } from "./handlers";
