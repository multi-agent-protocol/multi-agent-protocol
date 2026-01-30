/**
 * In-memory MessageQueueStore implementation
 */

import type { QueuedMessage, MessageQueueStore } from "../../types";

/**
 * In-memory implementation of MessageQueueStore.
 * Messages are stored in priority queues per agent.
 */
export class InMemoryMessageQueueStore implements MessageQueueStore {
  // Map of agentId -> array of queued messages (sorted by priority, then timestamp)
  private readonly queues: Map<string, QueuedMessage[]> = new Map();
  // Index by message ID for quick removal
  private readonly messageIndex: Map<string, string> = new Map(); // messageId -> agentId

  /**
   * Enqueue a message for an agent.
   */
  enqueue(msg: QueuedMessage): void {
    const queue = this.queues.get(msg.targetAgentId) ?? [];

    // Insert in priority order (lower priority number = higher priority)
    // For same priority, maintain FIFO order by queuedAt
    const priority = msg.message.priority ?? Number.MAX_SAFE_INTEGER;
    let insertIndex = queue.length;

    for (let i = 0; i < queue.length; i++) {
      const existing = queue[i];
      const existingPriority = existing.message.priority ?? Number.MAX_SAFE_INTEGER;

      if (priority < existingPriority) {
        insertIndex = i;
        break;
      }
      if (priority === existingPriority && msg.queuedAt < existing.queuedAt) {
        insertIndex = i;
        break;
      }
    }

    queue.splice(insertIndex, 0, msg);
    this.queues.set(msg.targetAgentId, queue);
    this.messageIndex.set(msg.message.id, msg.targetAgentId);
  }

  /**
   * Dequeue messages for an agent (removes from queue).
   */
  dequeue(agentId: string, limit?: number): QueuedMessage[] {
    const queue = this.queues.get(agentId);
    if (!queue || queue.length === 0) {
      return [];
    }

    const count = limit ?? queue.length;
    const messages = queue.splice(0, count);

    // Clean up index
    for (const msg of messages) {
      this.messageIndex.delete(msg.message.id);
    }

    // Remove empty queue
    if (queue.length === 0) {
      this.queues.delete(agentId);
    }

    return messages;
  }

  /**
   * Peek at queued messages without removing them.
   */
  peek(agentId: string, limit?: number): QueuedMessage[] {
    const queue = this.queues.get(agentId);
    if (!queue || queue.length === 0) {
      return [];
    }

    const count = limit ?? queue.length;
    return queue.slice(0, count);
  }

  /**
   * Remove a specific message by ID.
   */
  remove(messageId: string): boolean {
    const agentId = this.messageIndex.get(messageId);
    if (!agentId) {
      return false;
    }

    const queue = this.queues.get(agentId);
    if (!queue) {
      return false;
    }

    const index = queue.findIndex((m) => m.message.id === messageId);
    if (index === -1) {
      return false;
    }

    queue.splice(index, 1);
    this.messageIndex.delete(messageId);

    // Remove empty queue
    if (queue.length === 0) {
      this.queues.delete(agentId);
    }

    return true;
  }

  /**
   * Get queue size for a specific agent.
   */
  getQueueSize(agentId: string): number {
    return this.queues.get(agentId)?.length ?? 0;
  }

  /**
   * Get total queued messages across all agents.
   */
  getTotalSize(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.length;
    }
    return total;
  }

  /**
   * Expire old messages that have passed their TTL.
   * @returns Number of messages expired
   */
  expireOld(): number {
    const now = Date.now();
    let expiredCount = 0;

    for (const [agentId, queue] of this.queues.entries()) {
      const validMessages: QueuedMessage[] = [];

      for (const msg of queue) {
        if (msg.expiresAt <= now) {
          this.messageIndex.delete(msg.message.id);
          expiredCount++;
        } else {
          validMessages.push(msg);
        }
      }

      if (validMessages.length === 0) {
        this.queues.delete(agentId);
      } else if (validMessages.length !== queue.length) {
        this.queues.set(agentId, validMessages);
      }
    }

    return expiredCount;
  }

  /**
   * Clear all queued messages.
   */
  clear(): void {
    this.queues.clear();
    this.messageIndex.clear();
  }

  /**
   * Get queue sizes by agent (for stats).
   */
  getQueueSizesByAgent(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [agentId, queue] of this.queues.entries()) {
      result[agentId] = queue.length;
    }
    return result;
  }
}
