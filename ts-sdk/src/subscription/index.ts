/**
 * Subscription class for MAP event streams
 *
 * Provides both AsyncIterable and event emitter patterns for consuming events.
 * Includes automatic deduplication based on eventId when provided by the server.
 */

import type {
  SubscriptionId,
  Event,
  SubscriptionFilter,
  SubscriptionState,
  SubscriptionAckParams,
  OverflowInfo,
  OverflowHandler,
  EventNotificationParams,
} from '../types';

/**
 * Event handler callback type
 */
export type EventHandler = (event: Event) => void;

/**
 * Subscription options
 */
export interface SubscriptionOptions {
  /** Filter for events */
  filter?: SubscriptionFilter;
  /** Buffer size for events before backpressure */
  bufferSize?: number;
  /**
   * Maximum number of eventIds to track for deduplication.
   * Older eventIds are evicted when this limit is reached.
   * Default: 10000
   */
  maxSeenEventIds?: number;
}

/**
 * Subscription to MAP events.
 *
 * Supports both async iteration and event handler patterns:
 *
 * ```typescript
 * // Async iteration
 * for await (const event of subscription) {
 *   console.log(event);
 * }
 *
 * // Event handler
 * subscription.on('event', (event) => console.log(event));
 * ```
 *
 * ## Deduplication
 *
 * When the server provides `eventId` in the notification params,
 * the subscription automatically deduplicates events. This handles
 * scenarios like:
 * - Network retries delivering the same event twice
 * - Reconnection replay overlapping with already-received events
 *
 * If `eventId` is not provided, deduplication is skipped.
 *
 * ## Pause/Resume
 *
 * You can pause event delivery from the async iterator while still
 * buffering events:
 *
 * ```typescript
 * subscription.pause();
 * // Events are buffered but not yielded
 * subscription.resume();
 * // Buffered events are now yielded
 * ```
 *
 * ## Overflow Handling
 *
 * When the buffer is full, events are dropped and overflow handlers
 * are notified:
 *
 * ```typescript
 * subscription.on('overflow', (info) => {
 *   console.log(`Dropped ${info.eventsDropped} events`);
 * });
 * ```
 */
export class Subscription implements AsyncIterable<Event> {
  readonly id: SubscriptionId;
  readonly filter?: SubscriptionFilter;

  readonly #eventHandlers: Set<EventHandler> = new Set();
  readonly #overflowHandlers: Set<OverflowHandler> = new Set();
  readonly #eventQueue: Event[] = [];
  readonly #bufferSize: number;
  readonly #unsubscribe: () => Promise<void>;
  readonly #sendAck?: (params: SubscriptionAckParams) => void;

  // Deduplication tracking
  readonly #seenEventIds: Set<string> = new Set();
  readonly #seenEventIdOrder: string[] = []; // For LRU eviction
  readonly #maxSeenEventIds: number;

  #eventResolver: ((event: Event | null) => void) | null = null;
  #pauseResolver: (() => void) | null = null;
  #state: SubscriptionState = 'active';
  #lastSequenceNumber = -1;
  #lastEventId: string | undefined;
  #lastTimestamp: number | undefined;

  // Overflow tracking
  #totalDropped = 0;
  #oldestDroppedId?: string;
  #newestDroppedId?: string;

  // Ack support
  #serverSupportsAck = false;

  constructor(
    id: SubscriptionId,
    unsubscribe: () => Promise<void>,
    options: SubscriptionOptions = {},
    sendAck?: (params: SubscriptionAckParams) => void
  ) {
    this.id = id;
    this.filter = options.filter;
    this.#bufferSize = options.bufferSize ?? 1000;
    this.#maxSeenEventIds = options.maxSeenEventIds ?? 10000;
    this.#unsubscribe = unsubscribe;
    this.#sendAck = sendAck;
  }

  /**
   * Current subscription state
   */
  get state(): SubscriptionState {
    return this.#state;
  }

  /**
   * Whether the subscription is closed
   */
  get isClosed(): boolean {
    return this.#state === 'closed';
  }

  /**
   * Whether the subscription is paused
   */
  get isPaused(): boolean {
    return this.#state === 'paused';
  }

  /**
   * Last received sequence number (for ordering verification)
   */
  get lastSequenceNumber(): number {
    return this.#lastSequenceNumber;
  }

  /**
   * Last received eventId (for replay positioning)
   */
  get lastEventId(): string | undefined {
    return this.#lastEventId;
  }

  /**
   * Last received server timestamp
   */
  get lastTimestamp(): number | undefined {
    return this.#lastTimestamp;
  }

  /**
   * Number of events currently buffered
   */
  get bufferedCount(): number {
    return this.#eventQueue.length;
  }

  /**
   * Number of eventIds being tracked for deduplication
   */
  get trackedEventIdCount(): number {
    return this.#seenEventIds.size;
  }

  /**
   * Total number of events dropped due to buffer overflow
   */
  get totalDropped(): number {
    return this.#totalDropped;
  }

  /**
   * Whether the server supports acknowledgments
   */
  get supportsAck(): boolean {
    return this.#serverSupportsAck && !!this.#sendAck;
  }

  /**
   * Pause event delivery from the async iterator.
   * Events are still buffered but not yielded until resume() is called.
   * Event handlers (on('event', ...)) still receive events while paused.
   */
  pause(): void {
    if (this.#state === 'closed') return;
    this.#state = 'paused';
  }

  /**
   * Resume event delivery from the async iterator.
   * Any events buffered during pause will be yielded.
   */
  resume(): void {
    if (this.#state === 'closed') return;
    this.#state = 'active';

    // Wake up paused iterator
    if (this.#pauseResolver) {
      this.#pauseResolver();
      this.#pauseResolver = null;
    }

    // If iterator is waiting for events and we have buffered events, deliver one
    if (this.#eventResolver && this.#eventQueue.length > 0) {
      const event = this.#eventQueue.shift()!;
      this.#eventResolver(event);
      this.#eventResolver = null;
    }
  }

  /**
   * Acknowledge events up to a sequence number.
   * No-op if server doesn't support acks.
   *
   * @param upToSequence - Acknowledge all events up to and including this sequence.
   *                       If omitted, acknowledges up to lastSequenceNumber.
   */
  ack(upToSequence?: number): void {
    if (!this.supportsAck) return;

    const seq = upToSequence ?? this.#lastSequenceNumber;
    if (seq < 0) return; // No events received yet

    this.#sendAck!({
      subscriptionId: this.id,
      upToSequence: seq,
    });
  }

  /**
   * Register an event or overflow handler
   */
  on(type: 'event', handler: EventHandler): this;
  on(type: 'overflow', handler: OverflowHandler): this;
  on(type: 'event' | 'overflow', handler: EventHandler | OverflowHandler): this {
    if (type === 'event') {
      this.#eventHandlers.add(handler as EventHandler);
    } else if (type === 'overflow') {
      this.#overflowHandlers.add(handler as OverflowHandler);
    }
    return this;
  }

  /**
   * Remove an event or overflow handler
   */
  off(type: 'event', handler: EventHandler): this;
  off(type: 'overflow', handler: OverflowHandler): this;
  off(type: 'event' | 'overflow', handler: EventHandler | OverflowHandler): this {
    if (type === 'event') {
      this.#eventHandlers.delete(handler as EventHandler);
    } else if (type === 'overflow') {
      this.#overflowHandlers.delete(handler as OverflowHandler);
    }
    return this;
  }

  /**
   * Register a one-time event handler
   */
  once(type: 'event', handler: EventHandler): this {
    if (type === 'event') {
      const wrapper: EventHandler = (event) => {
        this.off('event', wrapper);
        handler(event);
      };
      this.on('event', wrapper);
    }
    return this;
  }

  /**
   * Unsubscribe and close the subscription
   */
  async unsubscribe(): Promise<void> {
    if (this.#state === 'closed') return;

    this.#state = 'closed';

    // Resolve any waiting iterator
    if (this.#eventResolver) {
      this.#eventResolver(null);
      this.#eventResolver = null;
    }

    // Wake up any paused iterator
    if (this.#pauseResolver) {
      this.#pauseResolver();
      this.#pauseResolver = null;
    }

    // Clear handlers and tracking
    this.#eventHandlers.clear();
    this.#overflowHandlers.clear();
    this.#seenEventIds.clear();
    this.#seenEventIdOrder.length = 0;

    // Call the unsubscribe callback
    await this.#unsubscribe();
  }

  /**
   * Set whether server supports acknowledgments.
   * Called by connection after capability negotiation.
   * @internal
   */
  _setServerSupportsAck(supports: boolean): void {
    this.#serverSupportsAck = supports;
  }

  /**
   * Push an event to the subscription (called by connection)
   * @internal
   */
  _pushEvent(params: EventNotificationParams): void {
    if (this.#state === 'closed') return;

    const { sequenceNumber, eventId, timestamp, event } = params;

    // Deduplicate by eventId if provided
    if (eventId) {
      if (this.#seenEventIds.has(eventId)) {
        // Duplicate event, skip silently
        return;
      }

      // Track this eventId
      this.#seenEventIds.add(eventId);
      this.#seenEventIdOrder.push(eventId);

      // LRU eviction if we've exceeded the limit
      while (this.#seenEventIds.size > this.#maxSeenEventIds) {
        const oldestId = this.#seenEventIdOrder.shift();
        if (oldestId) {
          this.#seenEventIds.delete(oldestId);
        }
      }

      // Track last eventId for replay positioning
      this.#lastEventId = eventId;
    }

    // Track last timestamp
    if (timestamp !== undefined) {
      this.#lastTimestamp = timestamp;
    }

    // Check for sequence gaps (out of order or missed events)
    if (this.#lastSequenceNumber >= 0 && sequenceNumber !== this.#lastSequenceNumber + 1) {
      console.warn(
        `MAP: Subscription ${this.id} sequence gap: expected ${this.#lastSequenceNumber + 1}, got ${sequenceNumber}`
      );
    }
    this.#lastSequenceNumber = sequenceNumber;

    // Notify event handlers (always, even when paused)
    for (const handler of this.#eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('MAP: Event handler error:', error);
      }
    }

    // If there's a waiting iterator and not paused, resolve it directly
    if (this.#eventResolver && this.#state === 'active') {
      this.#eventResolver(event);
      this.#eventResolver = null;
      return;
    }

    // Otherwise buffer the event
    if (this.#eventQueue.length < this.#bufferSize) {
      this.#eventQueue.push(event);
    } else {
      // Buffer overflow - track and notify
      this.#totalDropped++;

      // Track oldest/newest dropped event IDs
      if (eventId) {
        if (this.#oldestDroppedId === undefined) {
          this.#oldestDroppedId = eventId;
        }
        this.#newestDroppedId = eventId;
      }

      // Notify overflow handlers
      const info: OverflowInfo = {
        eventsDropped: 1,
        oldestDroppedId: this.#oldestDroppedId,
        newestDroppedId: this.#newestDroppedId,
        timestamp: Date.now(),
        totalDropped: this.#totalDropped,
      };

      for (const handler of this.#overflowHandlers) {
        try {
          handler(info);
        } catch (error) {
          console.error('MAP: Overflow handler error:', error);
        }
      }

      console.warn(`MAP: Subscription ${this.id} buffer full, dropping event`);
    }
  }

  /**
   * Mark the subscription as closed (called by connection)
   * @internal
   */
  _close(): void {
    this.#state = 'closed';

    // Resolve any waiting iterator
    if (this.#eventResolver) {
      this.#eventResolver(null);
      this.#eventResolver = null;
    }

    // Wake up any paused iterator
    if (this.#pauseResolver) {
      this.#pauseResolver();
      this.#pauseResolver = null;
    }
  }

  /**
   * Async iterator implementation
   */
  async *[Symbol.asyncIterator](): AsyncIterator<Event> {
    while (!this.isClosed) {
      // Wait while paused
      while (this.isPaused) {
        await new Promise<void>((resolve) => {
          this.#pauseResolver = resolve;
        });
        // Check if closed during pause - need to break out of both loops
        if (this.isClosed) {
          // Drain remaining buffered events before returning
          while (this.#eventQueue.length > 0) {
            yield this.#eventQueue.shift()!;
          }
          return;
        }
      }

      // Return buffered events first
      if (this.#eventQueue.length > 0) {
        yield this.#eventQueue.shift()!;
        continue;
      }

      // Wait for next event
      const event = await new Promise<Event | null>((resolve) => {
        this.#eventResolver = resolve;
      });

      if (event === null) {
        // Subscription closed
        break;
      }

      yield event;
    }

    // Drain remaining buffered events
    while (this.#eventQueue.length > 0) {
      yield this.#eventQueue.shift()!;
    }
  }
}

/**
 * Create a subscription instance
 * @internal
 */
export function createSubscription(
  id: SubscriptionId,
  unsubscribe: () => Promise<void>,
  options?: SubscriptionOptions,
  sendAck?: (params: SubscriptionAckParams) => void
): Subscription {
  return new Subscription(id, unsubscribe, options, sendAck);
}
