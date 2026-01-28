/**
 * Subscription class for MAP event streams
 *
 * Provides both AsyncIterable and event emitter patterns for consuming events.
 */

import type {
  SubscriptionId,
  Event,
  SubscriptionFilter,
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
 */
export class Subscription implements AsyncIterable<Event> {
  readonly id: SubscriptionId;
  readonly filter?: SubscriptionFilter;

  readonly #eventHandlers: Set<EventHandler> = new Set();
  readonly #eventQueue: Event[] = [];
  readonly #bufferSize: number;
  readonly #unsubscribe: () => Promise<void>;

  #eventResolver: ((event: Event | null) => void) | null = null;
  #closed = false;
  #lastSequenceNumber = -1;

  constructor(
    id: SubscriptionId,
    unsubscribe: () => Promise<void>,
    options: SubscriptionOptions = {}
  ) {
    this.id = id;
    this.filter = options.filter;
    this.#bufferSize = options.bufferSize ?? 1000;
    this.#unsubscribe = unsubscribe;
  }

  /**
   * Whether the subscription is closed
   */
  get isClosed(): boolean {
    return this.#closed;
  }

  /**
   * Last received sequence number (for ordering verification)
   */
  get lastSequenceNumber(): number {
    return this.#lastSequenceNumber;
  }

  /**
   * Number of events currently buffered
   */
  get bufferedCount(): number {
    return this.#eventQueue.length;
  }

  /**
   * Register an event handler
   */
  on(type: 'event', handler: EventHandler): this {
    if (type === 'event') {
      this.#eventHandlers.add(handler);
    }
    return this;
  }

  /**
   * Remove an event handler
   */
  off(type: 'event', handler: EventHandler): this {
    if (type === 'event') {
      this.#eventHandlers.delete(handler);
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
    if (this.#closed) return;

    this.#closed = true;

    // Resolve any waiting iterator
    if (this.#eventResolver) {
      this.#eventResolver(null);
      this.#eventResolver = null;
    }

    // Clear handlers
    this.#eventHandlers.clear();

    // Call the unsubscribe callback
    await this.#unsubscribe();
  }

  /**
   * Push an event to the subscription (called by connection)
   * @internal
   */
  _pushEvent(params: EventNotificationParams): void {
    if (this.#closed) return;

    const { sequenceNumber, event } = params;

    // Check for sequence gaps (out of order or missed events)
    if (this.#lastSequenceNumber >= 0 && sequenceNumber !== this.#lastSequenceNumber + 1) {
      console.warn(
        `MAP: Subscription ${this.id} sequence gap: expected ${this.#lastSequenceNumber + 1}, got ${sequenceNumber}`
      );
    }
    this.#lastSequenceNumber = sequenceNumber;

    // Notify event handlers
    for (const handler of this.#eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('MAP: Event handler error:', error);
      }
    }

    // If there's a waiting iterator, resolve it directly
    if (this.#eventResolver) {
      this.#eventResolver(event);
      this.#eventResolver = null;
      return;
    }

    // Otherwise buffer the event
    if (this.#eventQueue.length < this.#bufferSize) {
      this.#eventQueue.push(event);
    } else {
      console.warn(
        `MAP: Subscription ${this.id} buffer full, dropping event`
      );
    }
  }

  /**
   * Mark the subscription as closed (called by connection)
   * @internal
   */
  _close(): void {
    this.#closed = true;

    // Resolve any waiting iterator
    if (this.#eventResolver) {
      this.#eventResolver(null);
      this.#eventResolver = null;
    }
  }

  /**
   * Async iterator implementation
   */
  async *[Symbol.asyncIterator](): AsyncIterator<Event> {
    while (!this.#closed) {
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
  options?: SubscriptionOptions
): Subscription {
  return new Subscription(id, unsubscribe, options);
}
