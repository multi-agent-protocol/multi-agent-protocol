/**
 * Mail system - Conversations, Turns, Threads, Participants
 *
 * Storage interfaces, in-memory implementations, and managers for the Mail protocol.
 */

// Re-export types
export type {
  ServerConversation,
  ServerTurn,
  ServerThread,
  ServerParticipant,
  ConversationFilter,
  TurnFilter,
  ThreadFilter,
  ParticipantFilter,
  ConversationStore,
  TurnStore,
  ThreadStore,
  ParticipantStore,
  DefaultParticipantPermissions,
  ConversationGetResult,
  ConversationManager,
  ConversationManagerOptions,
  TurnManager,
  TurnManagerOptions,
  ThreadManager,
  ThreadManagerOptions,
} from "../types";

// In-memory store implementations
export {
  InMemoryConversationStore,
  type InMemoryConversationStoreOptions,
} from "./stores/in-memory-conversation";
export { InMemoryTurnStore } from "./stores/in-memory-turn";
export { InMemoryThreadStore } from "./stores/in-memory-thread";
export { InMemoryParticipantStore } from "./stores/in-memory-participant";

// Manager implementations
export {
  ConversationManagerImpl,
  ConversationNotFoundError,
  ConversationClosedError,
  ParticipantAlreadyJoinedError,
  ParticipantNotFoundError,
} from "./conversation-manager";
export {
  TurnManagerImpl,
  TurnNotFoundError,
  TurnConversationNotFoundError,
  InvalidContentTypeError,
  validateContentType,
} from "./turn-manager";
export {
  ThreadManagerImpl,
  ThreadNotFoundError,
  RootTurnNotFoundError,
  RootTurnConversationMismatchError,
  ParentThreadNotFoundError,
} from "./thread-manager";

// Handler factory
export { createMailHandlers, type MailHandlerOptions } from "./handlers";
