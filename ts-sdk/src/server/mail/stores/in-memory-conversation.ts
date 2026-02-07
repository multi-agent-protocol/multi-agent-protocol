/**
 * In-memory ConversationStore implementation
 */

import type {
  ServerConversation,
  ConversationFilter,
  ConversationStore,
  ParticipantStore,
} from "../../types";

/**
 * Options for InMemoryConversationStore
 */
export interface InMemoryConversationStoreOptions {
  /**
   * ParticipantStore for participant-based filtering.
   * Required only if you use ConversationFilter.participantId.
   */
  participantStore?: ParticipantStore;
}

/**
 * In-memory implementation of ConversationStore.
 */
export class InMemoryConversationStore implements ConversationStore {
  private readonly conversations: Map<string, ServerConversation> = new Map();
  private readonly participantStore?: ParticipantStore;

  constructor(options: InMemoryConversationStoreOptions = {}) {
    this.participantStore = options.participantStore;
  }

  /**
   * Save a conversation (create or update).
   */
  save(conversation: ServerConversation): void {
    this.conversations.set(conversation.id, { ...conversation });
  }

  /**
   * Get conversation by ID.
   */
  get(id: string): ServerConversation | undefined {
    const conversation = this.conversations.get(id);
    return conversation ? { ...conversation } : undefined;
  }

  /**
   * List conversations matching filter criteria.
   */
  list(filter?: ConversationFilter): ServerConversation[] {
    const results: ServerConversation[] = [];

    // If filtering by participant, get their conversation IDs first
    let participantConversationIds: Set<string> | undefined;
    if (filter?.participantId && this.participantStore) {
      const ids = this.participantStore.getConversationsForParticipant(
        filter.participantId,
        true
      );
      participantConversationIds = new Set(ids);
    }

    for (const conversation of this.conversations.values()) {
      // Filter by type
      if (filter?.type && filter.type.length > 0) {
        if (!filter.type.includes(conversation.type)) continue;
      }

      // Filter by status
      if (filter?.status && filter.status.length > 0) {
        if (!filter.status.includes(conversation.status)) continue;
      }

      // Filter by participant
      if (participantConversationIds !== undefined) {
        if (!participantConversationIds.has(conversation.id)) continue;
      } else if (filter?.participantId) {
        // No participant store available - skip participant filtering
        continue;
      }

      // Filter by created after
      if (filter?.createdAfter !== undefined) {
        if (conversation.createdAt <= filter.createdAfter) continue;
      }

      // Filter by created before
      if (filter?.createdBefore !== undefined) {
        if (conversation.createdAt >= filter.createdBefore) continue;
      }

      // Filter by parent conversation
      if (filter?.parentConversationId !== undefined) {
        if (conversation.parentConversationId !== filter.parentConversationId) continue;
      }

      results.push({ ...conversation });
    }

    return results;
  }

  /**
   * Delete a conversation by ID.
   */
  delete(id: string): boolean {
    return this.conversations.delete(id);
  }

  /**
   * Clear all conversations.
   */
  clear(): void {
    this.conversations.clear();
  }

  /**
   * Get the number of stored conversations.
   */
  get size(): number {
    return this.conversations.size;
  }
}
