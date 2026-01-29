/**
 * Federation Outage Buffer
 *
 * Buffers outbound messages during federation outages for later delivery
 * when the peer reconnects.
 */

import type {
  FederationEnvelope,
  FederationBufferConfig,
  Message,
  Timestamp,
} from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * A buffered message with metadata.
 */
interface BufferedMessage {
  envelope: FederationEnvelope<Message>;
  enqueuedAt: Timestamp;
  size: number;
}

/**
 * Per-peer buffer state.
 */
interface PeerBuffer {
  messages: BufferedMessage[];
  totalEnqueued: number;
  totalDropped: number;
  totalBytes: number;
}

/**
 * Buffer statistics for a peer.
 */
export interface PeerBufferStats {
  /** Number of messages currently buffered */
  count: number;
  /** Age of oldest message in milliseconds */
  oldestAge: number;
  /** Total messages ever enqueued */
  totalEnqueued: number;
  /** Total messages dropped due to overflow/expiry */
  totalDropped: number;
  /** Current buffer size in bytes */
  totalBytes: number;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: Required<FederationBufferConfig> = {
  enabled: true,
  maxMessages: 1000,
  maxBytes: 10 * 1024 * 1024, // 10MB
  retentionMs: 60 * 60 * 1000, // 1 hour
  overflowStrategy: 'drop-oldest',
};

// =============================================================================
// Buffer Implementation
// =============================================================================

/**
 * Buffer for storing outbound messages during federation outages.
 *
 * Messages are stored per-peer and drained on reconnection.
 * Supports configurable size limits, retention, and overflow strategies.
 *
 * @example
 * ```typescript
 * const buffer = new FederationOutageBuffer({
 *   maxMessages: 500,
 *   retentionMs: 30000,
 *   overflowStrategy: 'drop-oldest',
 * });
 *
 * // Buffer messages during outage
 * buffer.enqueue('peer-1', envelope);
 *
 * // On reconnect, drain and send
 * const messages = buffer.drain('peer-1');
 * for (const msg of messages) {
 *   await send(msg);
 * }
 * ```
 */
export class FederationOutageBuffer {
  readonly #config: Required<FederationBufferConfig>;
  readonly #buffers: Map<string, PeerBuffer> = new Map();

  constructor(config?: FederationBufferConfig) {
    this.#config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Whether buffering is enabled.
   */
  get enabled(): boolean {
    return this.#config.enabled;
  }

  /**
   * Get the configuration.
   */
  get config(): Readonly<Required<FederationBufferConfig>> {
    return this.#config;
  }

  /**
   * Enqueue a message for a peer.
   *
   * @param peerId - Target peer system ID
   * @param envelope - Message envelope to buffer
   * @returns true if message was buffered, false if rejected
   */
  enqueue(peerId: string, envelope: FederationEnvelope<Message>): boolean {
    if (!this.#config.enabled) return false;

    let buffer = this.#buffers.get(peerId);
    if (!buffer) {
      buffer = { messages: [], totalEnqueued: 0, totalDropped: 0, totalBytes: 0 };
      this.#buffers.set(peerId, buffer);
    }

    // Evict expired messages first
    this.#evictExpired(buffer);

    // Estimate message size
    const messageSize = this.#estimateSize(envelope);

    // Check byte limit
    while (buffer.totalBytes + messageSize > this.#config.maxBytes && buffer.messages.length > 0) {
      const removed = buffer.messages.shift()!;
      buffer.totalBytes -= removed.size;
      buffer.totalDropped++;
    }

    // Check message count limit
    if (buffer.messages.length >= this.#config.maxMessages) {
      switch (this.#config.overflowStrategy) {
        case 'drop-oldest': {
          const removed = buffer.messages.shift()!;
          buffer.totalBytes -= removed.size;
          buffer.totalDropped++;
          break;
        }
        case 'drop-newest':
          buffer.totalDropped++;
          return false;
        case 'reject':
          return false;
      }
    }

    buffer.messages.push({
      envelope,
      enqueuedAt: Date.now(),
      size: messageSize,
    });
    buffer.totalEnqueued++;
    buffer.totalBytes += messageSize;

    return true;
  }

  /**
   * Drain all buffered messages for a peer.
   *
   * Returns messages in FIFO order and clears the buffer.
   *
   * @param peerId - Target peer system ID
   * @returns Array of buffered envelopes
   */
  drain(peerId: string): FederationEnvelope<Message>[] {
    const buffer = this.#buffers.get(peerId);
    if (!buffer) return [];

    // Evict expired before draining
    this.#evictExpired(buffer);

    const messages = buffer.messages.map((m) => m.envelope);
    buffer.messages = [];
    buffer.totalBytes = 0;

    return messages;
  }

  /**
   * Peek at buffered messages without removing them.
   *
   * @param peerId - Target peer system ID
   * @returns Array of buffered envelopes (still in buffer)
   */
  peek(peerId: string): FederationEnvelope<Message>[] {
    const buffer = this.#buffers.get(peerId);
    if (!buffer) return [];

    // Evict expired
    this.#evictExpired(buffer);

    return buffer.messages.map((m) => m.envelope);
  }

  /**
   * Get statistics for all peer buffers.
   *
   * @returns Map of peer ID to buffer stats
   */
  stats(): Map<string, PeerBufferStats> {
    const result = new Map<string, PeerBufferStats>();
    const now = Date.now();

    for (const [peerId, buffer] of this.#buffers) {
      // Evict expired for accurate stats
      this.#evictExpired(buffer);

      const oldestAge =
        buffer.messages.length > 0 ? now - buffer.messages[0].enqueuedAt : 0;

      result.set(peerId, {
        count: buffer.messages.length,
        oldestAge,
        totalEnqueued: buffer.totalEnqueued,
        totalDropped: buffer.totalDropped,
        totalBytes: buffer.totalBytes,
      });
    }

    return result;
  }

  /**
   * Get count for a specific peer.
   *
   * @param peerId - Target peer system ID
   * @returns Number of buffered messages
   */
  count(peerId: string): number {
    const buffer = this.#buffers.get(peerId);
    if (!buffer) return 0;

    this.#evictExpired(buffer);
    return buffer.messages.length;
  }

  /**
   * Check if buffer has messages for a peer.
   *
   * @param peerId - Target peer system ID
   * @returns true if there are buffered messages
   */
  has(peerId: string): boolean {
    return this.count(peerId) > 0;
  }

  /**
   * Clear buffer for a specific peer.
   *
   * @param peerId - Target peer system ID
   */
  clear(peerId: string): void {
    this.#buffers.delete(peerId);
  }

  /**
   * Clear all buffers.
   */
  clearAll(): void {
    this.#buffers.clear();
  }

  /**
   * Get list of peers with buffered messages.
   *
   * @returns Array of peer IDs
   */
  peers(): string[] {
    const result: string[] = [];
    for (const [peerId, buffer] of this.#buffers) {
      this.#evictExpired(buffer);
      if (buffer.messages.length > 0) {
        result.push(peerId);
      }
    }
    return result;
  }

  /**
   * Evict expired messages from a buffer.
   */
  #evictExpired(buffer: PeerBuffer): void {
    const cutoff = Date.now() - this.#config.retentionMs;
    let removed = 0;
    let bytesRemoved = 0;

    while (buffer.messages.length > 0 && buffer.messages[0].enqueuedAt < cutoff) {
      const msg = buffer.messages.shift()!;
      bytesRemoved += msg.size;
      removed++;
    }

    buffer.totalDropped += removed;
    buffer.totalBytes -= bytesRemoved;
  }

  /**
   * Estimate the size of an envelope in bytes.
   */
  #estimateSize(envelope: FederationEnvelope<Message>): number {
    // Simple estimation using JSON serialization
    try {
      return JSON.stringify(envelope).length * 2; // UTF-16
    } catch {
      return 1024; // Default estimate if serialization fails
    }
  }
}
