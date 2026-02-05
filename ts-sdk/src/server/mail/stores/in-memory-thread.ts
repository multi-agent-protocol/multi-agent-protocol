/**
 * In-memory ThreadStore implementation
 */

import type {
  ServerThread,
  ThreadFilter,
  ThreadStore,
} from "../../types";

/**
 * In-memory implementation of ThreadStore.
 */
export class InMemoryThreadStore implements ThreadStore {
  private readonly threads: Map<string, ServerThread> = new Map();
  /** Index: conversationId → thread IDs */
  private readonly byConversation: Map<string, Set<string>> = new Map();

  /**
   * Save a thread (create or update).
   */
  save(thread: ServerThread): void {
    this.threads.set(thread.id, { ...thread });

    // Maintain conversation index
    let ids = this.byConversation.get(thread.conversationId);
    if (!ids) {
      ids = new Set();
      this.byConversation.set(thread.conversationId, ids);
    }
    ids.add(thread.id);
  }

  /**
   * Get thread by ID.
   */
  get(id: string): ServerThread | undefined {
    const thread = this.threads.get(id);
    return thread ? { ...thread } : undefined;
  }

  /**
   * List threads matching filter criteria.
   */
  list(filter: ThreadFilter): ServerThread[] {
    // Use conversation index for fast lookup
    const ids = this.byConversation.get(filter.conversationId);
    if (!ids) return [];

    const results: ServerThread[] = [];

    for (const id of ids) {
      const thread = this.threads.get(id);
      if (!thread) continue;

      // Filter by parent thread
      if (filter.parentThreadId !== undefined && thread.parentThreadId !== filter.parentThreadId) {
        continue;
      }

      results.push({ ...thread });
    }

    return results;
  }

  /**
   * Delete a thread by ID.
   */
  delete(id: string): boolean {
    const thread = this.threads.get(id);
    if (!thread) return false;

    this.threads.delete(id);
    this.byConversation.get(thread.conversationId)?.delete(id);

    return true;
  }

  /**
   * Delete all threads for a conversation.
   */
  deleteByConversation(conversationId: string): number {
    const ids = this.byConversation.get(conversationId);
    if (!ids) return 0;

    const count = ids.size;
    for (const id of ids) {
      this.threads.delete(id);
    }
    this.byConversation.delete(conversationId);

    return count;
  }

  /**
   * Clear all threads.
   */
  clear(): void {
    this.threads.clear();
    this.byConversation.clear();
  }

  /**
   * Get the number of stored threads.
   */
  get size(): number {
    return this.threads.size;
  }
}
