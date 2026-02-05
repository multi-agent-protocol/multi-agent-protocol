/**
 * Mail system - Conversations, Turns, Threads, Participants
 *
 * Storage interfaces and in-memory implementations for the Mail protocol.
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
} from "../types";

// In-memory store implementations
export {
  InMemoryConversationStore,
  type InMemoryConversationStoreOptions,
} from "./stores/in-memory-conversation";
export { InMemoryTurnStore } from "./stores/in-memory-turn";
export { InMemoryThreadStore } from "./stores/in-memory-thread";
export { InMemoryParticipantStore } from "./stores/in-memory-participant";
