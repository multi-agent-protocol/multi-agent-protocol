/**
 * Message system - MessageRouter with queuing
 */

// Re-export types
export type {
  ServerMessage,
  QueuedMessage,
  DeliveryHandler,
  MessageQueueOptions,
  MessageQueueStore,
  MessageRouter,
  MessageRouterOptions,
} from "../types";

// Implementations
export { MessageRouterImpl } from "./router";
export { InMemoryMessageQueueStore } from "./stores/in-memory";

// Handlers
export { createMessageHandlers, type MessageHandlerOptions } from "./handlers";
