/**
 * Causal Event Buffer
 *
 * Buffers events and releases them in causal order. Events with `causedBy`
 * dependencies are held until all their predecessor events have been seen.
 *
 * This is useful for:
 * - Ensuring events are processed in correct causal order
 * - Handling out-of-order event delivery
 * - Building consistent views from event streams
 */

import type { Event } from '../types';

/**
 * Event with envelope metadata for causal tracking
 */
export interface CausalEvent {
  /** Unique event identifier */
  eventId: string;
  /** Event IDs that must be processed before this event */
  causedBy?: string[];
  /** The event payload */
  event: Event;
  /** Timestamp when the event was received */
  receivedAt?: number;
}

/**
 * Options for CausalEventBuffer
 */
export interface CausalEventBufferOptions {
  /**
   * Maximum time (ms) to wait for causal predecessors before releasing anyway.
   * Default: 5000ms. Set to 0 or Infinity to wait indefinitely.
   */
  maxWaitTime?: number;

  /**
   * Maximum number of events to buffer before force-releasing oldest.
   * Default: 1000. Prevents unbounded memory growth.
   */
  maxBufferSize?: number;

  /**
   * Callback when an event is released despite missing predecessors (timeout or buffer overflow).
   */
  onForcedRelease?: (event: CausalEvent, missingPredecessors: string[]) => void;
}

/**
 * Result from pushing an event to the buffer
 */
export interface CausalBufferPushResult {
  /** Events that are now ready to be processed in causal order */
  ready: CausalEvent[];
  /** Number of events still waiting for predecessors */
  pending: number;
}

/**
 * Buffers events and releases them in causal order.
 *
 * Events with `causedBy` dependencies are held until all predecessor events
 * have been seen (pushed to the buffer). Events without dependencies are
 * released immediately.
 *
 * @example
 * ```typescript
 * const buffer = new CausalEventBuffer();
 *
 * // Event B depends on A, but arrives first
 * let result = buffer.push({
 *   eventId: 'B',
 *   causedBy: ['A'],
 *   event: { id: 'B', type: 'effect', timestamp: 2 }
 * });
 * console.log(result.ready);   // [] - B is waiting for A
 * console.log(result.pending); // 1
 *
 * // Event A arrives
 * result = buffer.push({
 *   eventId: 'A',
 *   event: { id: 'A', type: 'cause', timestamp: 1 }
 * });
 * console.log(result.ready);   // [A, B] - Both released in order
 * console.log(result.pending); // 0
 * ```
 */
export class CausalEventBuffer {
  readonly #options: Required<Omit<CausalEventBufferOptions, 'onForcedRelease'>> & {
    onForcedRelease?: CausalEventBufferOptions['onForcedRelease'];
  };

  /** Events seen (by eventId) - used to check if predecessors exist */
  readonly #seen: Set<string> = new Set();

  /** Events waiting for predecessors */
  readonly #pending: Map<string, CausalEvent> = new Map();

  /** Map from eventId to events waiting for it */
  readonly #waitingFor: Map<string, Set<string>> = new Map();

  constructor(options: CausalEventBufferOptions = {}) {
    this.#options = {
      maxWaitTime: options.maxWaitTime ?? 5000,
      maxBufferSize: options.maxBufferSize ?? 1000,
      onForcedRelease: options.onForcedRelease,
    };
  }

  /**
   * Push an event into the buffer.
   *
   * @param event - The event to buffer
   * @returns Events that are ready to be processed (in causal order)
   */
  push(event: CausalEvent): CausalBufferPushResult {
    const ready: CausalEvent[] = [];

    // Check if we've already seen this event (deduplication)
    if (this.#seen.has(event.eventId)) {
      return { ready, pending: this.#pending.size };
    }

    // Mark as seen
    this.#seen.add(event.eventId);

    // Add received timestamp if not present
    if (!event.receivedAt) {
      event = { ...event, receivedAt: Date.now() };
    }

    // Check for missing predecessors
    const missingPredecessors = this.#getMissingPredecessors(event);

    if (missingPredecessors.length === 0) {
      // No dependencies or all dependencies satisfied - release immediately
      ready.push(event);

      // Check if this event unblocks any pending events
      this.#releaseWaiting(event.eventId, ready);
    } else {
      // Wait for predecessors
      this.#pending.set(event.eventId, event);

      // Track what this event is waiting for
      for (const predecessorId of missingPredecessors) {
        if (!this.#waitingFor.has(predecessorId)) {
          this.#waitingFor.set(predecessorId, new Set());
        }
        this.#waitingFor.get(predecessorId)!.add(event.eventId);
      }
    }

    // Check for buffer overflow
    this.#handleBufferOverflow(ready);

    // Check for timeouts
    this.#handleTimeouts(ready);

    return { ready, pending: this.#pending.size };
  }

  /**
   * Get the number of events waiting for predecessors
   */
  get pendingCount(): number {
    return this.#pending.size;
  }

  /**
   * Get the number of unique events seen
   */
  get seenCount(): number {
    return this.#seen.size;
  }

  /**
   * Check if a specific event has been seen
   */
  hasSeen(eventId: string): boolean {
    return this.#seen.has(eventId);
  }

  /**
   * Force release all pending events, regardless of missing predecessors.
   * Useful for cleanup or when you know no more events are coming.
   *
   * @returns All pending events in the order they would be released
   */
  flush(): CausalEvent[] {
    const ready: CausalEvent[] = [];

    // Release all pending events, trying to maintain some order
    // Sort by receivedAt to release in arrival order
    const pendingList = Array.from(this.#pending.values()).sort(
      (a, b) => (a.receivedAt ?? 0) - (b.receivedAt ?? 0)
    );

    for (const event of pendingList) {
      const missingPredecessors = this.#getMissingPredecessors(event);
      if (missingPredecessors.length > 0) {
        this.#options.onForcedRelease?.(event, missingPredecessors);
      }
      ready.push(event);
    }

    this.#pending.clear();
    this.#waitingFor.clear();

    return ready;
  }

  /**
   * Clear all state (seen events, pending events)
   */
  clear(): void {
    this.#seen.clear();
    this.#pending.clear();
    this.#waitingFor.clear();
  }

  /**
   * Get missing predecessors for an event.
   * A predecessor is considered "missing" if it hasn't been released yet
   * (either not seen at all, or seen but still pending).
   */
  #getMissingPredecessors(event: CausalEvent): string[] {
    if (!event.causedBy || event.causedBy.length === 0) {
      return [];
    }

    return event.causedBy.filter((predecessorId) => {
      // Predecessor is missing if:
      // 1. We haven't seen it at all, OR
      // 2. We've seen it but it's still pending (waiting for its own predecessors)
      return !this.#seen.has(predecessorId) || this.#pending.has(predecessorId);
    });
  }

  /**
   * Release events that were waiting for a specific predecessor
   */
  #releaseWaiting(predecessorId: string, ready: CausalEvent[]): void {
    const waitingEventIds = this.#waitingFor.get(predecessorId);
    if (!waitingEventIds) return;

    // Remove this predecessor from the waiting map
    this.#waitingFor.delete(predecessorId);

    for (const waitingEventId of waitingEventIds) {
      const waitingEvent = this.#pending.get(waitingEventId);
      if (!waitingEvent) continue;

      // Check if all predecessors are now satisfied
      const stillMissing = this.#getMissingPredecessors(waitingEvent);

      if (stillMissing.length === 0) {
        // All predecessors satisfied - release this event
        this.#pending.delete(waitingEventId);
        ready.push(waitingEvent);

        // Recursively check if this event unblocks others
        this.#releaseWaiting(waitingEventId, ready);
      }
    }
  }

  /**
   * Handle buffer overflow by force-releasing oldest events
   */
  #handleBufferOverflow(ready: CausalEvent[]): void {
    while (this.#pending.size > this.#options.maxBufferSize) {
      // Find oldest pending event by receivedAt
      let oldest: CausalEvent | null = null;
      for (const event of this.#pending.values()) {
        if (!oldest || (event.receivedAt ?? 0) < (oldest.receivedAt ?? 0)) {
          oldest = event;
        }
      }

      if (oldest) {
        this.#forceRelease(oldest, ready);
      }
    }
  }

  /**
   * Handle events that have been waiting too long
   */
  #handleTimeouts(ready: CausalEvent[]): void {
    if (this.#options.maxWaitTime <= 0 || this.#options.maxWaitTime === Infinity) {
      return;
    }

    const now = Date.now();
    const toRelease: CausalEvent[] = [];

    for (const event of this.#pending.values()) {
      const waitTime = now - (event.receivedAt ?? now);
      if (waitTime >= this.#options.maxWaitTime) {
        toRelease.push(event);
      }
    }

    for (const event of toRelease) {
      this.#forceRelease(event, ready);
    }
  }

  /**
   * Force release an event despite missing predecessors
   */
  #forceRelease(event: CausalEvent, ready: CausalEvent[]): void {
    const missingPredecessors = this.#getMissingPredecessors(event);

    // Remove from pending
    this.#pending.delete(event.eventId);

    // Remove from waiting lists
    for (const predecessorId of event.causedBy ?? []) {
      const waiting = this.#waitingFor.get(predecessorId);
      if (waiting) {
        waiting.delete(event.eventId);
        if (waiting.size === 0) {
          this.#waitingFor.delete(predecessorId);
        }
      }
    }

    // Notify callback
    if (missingPredecessors.length > 0) {
      this.#options.onForcedRelease?.(event, missingPredecessors);
    }

    // Add to ready list
    ready.push(event);

    // Check if this unblocks others
    this.#releaseWaiting(event.eventId, ready);
  }
}

/**
 * Validate that events are in causal order.
 *
 * An event sequence is in causal order if no event appears before
 * any of its predecessors (events in its causedBy array).
 *
 * @param events - Events to validate
 * @returns True if events are in valid causal order
 *
 * @example
 * ```typescript
 * const events = [
 *   { eventId: 'A', event: {...} },
 *   { eventId: 'B', causedBy: ['A'], event: {...} },
 *   { eventId: 'C', causedBy: ['B'], event: {...} },
 * ];
 * console.log(validateCausalOrder(events)); // true
 *
 * const badOrder = [
 *   { eventId: 'B', causedBy: ['A'], event: {...} },
 *   { eventId: 'A', event: {...} },  // A should come before B
 * ];
 * console.log(validateCausalOrder(badOrder)); // false
 * ```
 */
export function validateCausalOrder(events: CausalEvent[]): boolean {
  const seen = new Set<string>();

  for (const event of events) {
    // Check all predecessors have been seen
    if (event.causedBy) {
      for (const predecessorId of event.causedBy) {
        if (!seen.has(predecessorId)) {
          return false;
        }
      }
    }

    seen.add(event.eventId);
  }

  return true;
}

/**
 * Sort events into causal order using topological sort.
 *
 * If the events form a valid DAG (no cycles), returns them in an order
 * where no event appears before its predecessors. If there are cycles
 * or missing predecessors, throws an error.
 *
 * @param events - Events to sort
 * @returns Events in causal order
 * @throws If events contain cycles or reference missing predecessors
 *
 * @example
 * ```typescript
 * const unordered = [
 *   { eventId: 'C', causedBy: ['B'], event: {...} },
 *   { eventId: 'A', event: {...} },
 *   { eventId: 'B', causedBy: ['A'], event: {...} },
 * ];
 * const ordered = sortCausalOrder(unordered);
 * // ordered = [A, B, C]
 * ```
 */
export function sortCausalOrder(events: CausalEvent[]): CausalEvent[] {
  const eventMap = new Map<string, CausalEvent>();
  for (const event of events) {
    eventMap.set(event.eventId, event);
  }

  const result: CausalEvent[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>(); // For cycle detection

  function visit(eventId: string): void {
    if (visited.has(eventId)) return;

    if (visiting.has(eventId)) {
      throw new Error(`Cycle detected involving event: ${eventId}`);
    }

    const event = eventMap.get(eventId);
    if (!event) {
      throw new Error(`Missing event: ${eventId}`);
    }

    visiting.add(eventId);

    // Visit predecessors first
    if (event.causedBy) {
      for (const predecessorId of event.causedBy) {
        if (!eventMap.has(predecessorId)) {
          throw new Error(`Missing predecessor: ${predecessorId} for event: ${eventId}`);
        }
        visit(predecessorId);
      }
    }

    visiting.delete(eventId);
    visited.add(eventId);
    result.push(event);
  }

  for (const event of events) {
    visit(event.eventId);
  }

  return result;
}
