/**
 * Subscription system - SubscriptionManager with causal ordering
 */

// Re-export types
export type {
  SubscriptionFilter,
  ServerSubscription,
  CausalOrderingOptions,
  SubscriptionStore,
  SubscriptionManager,
  SubscriptionManagerOptions,
  ReplayOptions,
} from "../types";

// Implementations
export { SubscriptionManagerImpl } from "./manager";
export { InMemorySubscriptionStore } from "./stores/in-memory";

// Re-export causal buffer utilities
export {
  CausalEventBuffer,
  validateCausalOrder,
  sortCausalOrder,
  type CausalEvent,
  type CausalEventBufferOptions,
  type CausalBufferPushResult,
} from "../../utils/causal-buffer";

// Handlers
export {
  createSubscriptionHandlers,
  type SubscriptionHandlerOptions,
} from "./handlers";
