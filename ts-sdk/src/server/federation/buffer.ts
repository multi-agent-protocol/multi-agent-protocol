/**
 * OutageBuffer implementation
 *
 * Buffers messages during peer outages for delivery on reconnect.
 */

import type {
  OutageBuffer,
  OutageBufferStats,
  ServerFederationEnvelope,
} from "../types";

/**
 * Default maximum messages per system.
 */
const DEFAULT_MAX_MESSAGES = 1000;

/**
 * OutageBuffer options.
 */
export interface OutageBufferOptions {
  /** Maximum messages to buffer per system */
  maxMessages?: number;
}

/**
 * OutageBuffer implementation.
 *
 * Provides FIFO buffering of federation messages during peer outages.
 * When buffer is full, oldest messages are dropped.
 *
 * @example
 * ```typescript
 * const buffer = new OutageBufferImpl({ maxMessages: 100 });
 *
 * // Buffer message during outage
 * buffer.add("peer-system", envelope);
 *
 * // On reconnect, flush and send
 * const pending = buffer.flush("peer-system");
 * for (const msg of pending) {
 *   await connection.send(msg);
 * }
 * ```
 */
export class OutageBufferImpl implements OutageBuffer {
  private readonly queues: Map<string, ServerFederationEnvelope[]> = new Map();
  private readonly maxMessages: number;

  constructor(options?: OutageBufferOptions) {
    this.maxMessages = options?.maxMessages ?? DEFAULT_MAX_MESSAGES;
  }

  /**
   * Add message to buffer for a system.
   *
   * If the buffer is full, the oldest message is dropped.
   */
  add(systemId: string, envelope: ServerFederationEnvelope): void {
    let queue = this.queues.get(systemId);
    if (!queue) {
      queue = [];
      this.queues.set(systemId, queue);
    }

    // Drop oldest if at capacity
    if (queue.length >= this.maxMessages) {
      queue.shift();
    }

    queue.push(envelope);
  }

  /**
   * Flush all buffered messages for a system.
   *
   * Returns messages in FIFO order and clears the buffer.
   */
  flush(systemId: string): ServerFederationEnvelope[] {
    const queue = this.queues.get(systemId);
    if (!queue) {
      return [];
    }

    this.queues.delete(systemId);
    return queue;
  }

  /**
   * Get buffer statistics.
   */
  stats(): OutageBufferStats {
    let total = 0;
    const bySystem: Record<string, number> = {};

    for (const [systemId, queue] of this.queues) {
      bySystem[systemId] = queue.length;
      total += queue.length;
    }

    return { total, bySystem };
  }

  /**
   * Clear all buffered messages.
   */
  clear(): void {
    this.queues.clear();
  }

  /**
   * Clear buffered messages for a specific system.
   */
  clearSystem(systemId: string): void {
    this.queues.delete(systemId);
  }
}
