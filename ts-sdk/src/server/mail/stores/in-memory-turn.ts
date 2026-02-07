/**
 * In-memory TurnStore implementation
 *
 * Supports cursor-based pagination and timestamp range queries.
 */

import type {
  ServerTurn,
  TurnFilter,
  TurnStore,
} from "../../types";

/**
 * In-memory implementation of TurnStore.
 *
 * Features:
 * - O(1) lookup by ID
 * - Ordered storage per conversation for efficient range queries
 * - Cursor-based pagination via afterTurnId/beforeTurnId
 * - Timestamp range filtering
 */
export class InMemoryTurnStore implements TurnStore {
  /** Index by turn ID for O(1) lookup */
  private readonly turns: Map<string, ServerTurn> = new Map();
  /** Ordered turn IDs per conversation (insertion order = chronological) */
  private readonly byConversation: Map<string, string[]> = new Map();

  /**
   * Append a turn.
   */
  append(turn: ServerTurn): void {
    // Don't allow duplicate IDs
    if (this.turns.has(turn.id)) {
      return;
    }

    this.turns.set(turn.id, { ...turn, metadata: { ...turn.metadata } });

    const order = this.byConversation.get(turn.conversationId) ?? [];
    order.push(turn.id);
    this.byConversation.set(turn.conversationId, order);
  }

  /**
   * Get a specific turn by ID.
   */
  get(id: string): ServerTurn | undefined {
    const turn = this.turns.get(id);
    return turn ? { ...turn, metadata: { ...turn.metadata } } : undefined;
  }

  /**
   * List turns matching filter criteria with pagination.
   */
  list(filter: TurnFilter): ServerTurn[] {
    const order = this.byConversation.get(filter.conversationId);
    if (!order || order.length === 0) {
      return [];
    }

    // Determine slice bounds from cursor
    let startIdx = 0;
    let endIdx = order.length;

    if (filter.afterTurnId) {
      const idx = order.indexOf(filter.afterTurnId);
      if (idx !== -1) {
        startIdx = idx + 1;
      }
    }

    if (filter.beforeTurnId) {
      const idx = order.indexOf(filter.beforeTurnId);
      if (idx !== -1) {
        endIdx = idx;
      }
    }

    // Collect matching turns
    const results: ServerTurn[] = [];
    const limit = filter.limit ?? Number.MAX_SAFE_INTEGER;
    const desc = filter.order === "desc";

    // Iterate in the requested direction
    if (desc) {
      for (let i = endIdx - 1; i >= startIdx && results.length < limit; i--) {
        const turn = this.turns.get(order[i]);
        if (turn && this.matchesTurnFilter(turn, filter)) {
          results.push({ ...turn, metadata: { ...turn.metadata } });
        }
      }
    } else {
      for (let i = startIdx; i < endIdx && results.length < limit; i++) {
        const turn = this.turns.get(order[i]);
        if (turn && this.matchesTurnFilter(turn, filter)) {
          results.push({ ...turn, metadata: { ...turn.metadata } });
        }
      }
    }

    return results;
  }

  /**
   * Delete a specific turn.
   */
  delete(id: string): boolean {
    const turn = this.turns.get(id);
    if (!turn) return false;

    this.turns.delete(id);

    const order = this.byConversation.get(turn.conversationId);
    if (order) {
      const idx = order.indexOf(id);
      if (idx !== -1) {
        order.splice(idx, 1);
      }
      if (order.length === 0) {
        this.byConversation.delete(turn.conversationId);
      }
    }

    return true;
  }

  /**
   * Delete all turns for a conversation.
   */
  deleteByConversation(conversationId: string): number {
    const order = this.byConversation.get(conversationId);
    if (!order) return 0;

    const count = order.length;
    for (const id of order) {
      this.turns.delete(id);
    }
    this.byConversation.delete(conversationId);

    return count;
  }

  /**
   * Count turns in a conversation.
   */
  count(conversationId: string, threadId?: string): number {
    const order = this.byConversation.get(conversationId);
    if (!order) return 0;

    if (!threadId) return order.length;

    let count = 0;
    for (const id of order) {
      const turn = this.turns.get(id);
      if (turn && turn.threadId === threadId) {
        count++;
      }
    }
    return count;
  }

  /**
   * Clear all turns.
   */
  clear(): void {
    this.turns.clear();
    this.byConversation.clear();
  }

  /**
   * Get the total number of stored turns.
   */
  get size(): number {
    return this.turns.size;
  }

  /**
   * Check if a turn matches the non-cursor/non-conversation filter criteria.
   */
  private matchesTurnFilter(turn: ServerTurn, filter: TurnFilter): boolean {
    // Filter by thread
    if (filter.threadId !== undefined && turn.threadId !== filter.threadId) {
      return false;
    }

    // Filter by content types
    if (filter.contentTypes && filter.contentTypes.length > 0) {
      if (!filter.contentTypes.includes(turn.contentType)) {
        return false;
      }
    }

    // Filter by participant
    if (filter.participantId !== undefined && turn.participant !== filter.participantId) {
      return false;
    }

    // Filter by timestamp range
    if (filter.afterTimestamp !== undefined && turn.timestamp <= filter.afterTimestamp) {
      return false;
    }
    if (filter.beforeTimestamp !== undefined && turn.timestamp >= filter.beforeTimestamp) {
      return false;
    }

    return true;
  }
}
