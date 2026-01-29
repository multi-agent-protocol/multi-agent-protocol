/**
 * In-memory EventStore implementation
 *
 * Provides ephemeral storage for events with configurable max size and LRU eviction.
 */

import type { MAPEvent, EventFilter, EventStore } from "../../types";
import { compareUlid } from "../../../utils/ulid";

/**
 * Options for InMemoryEventStore
 */
export interface InMemoryEventStoreOptions {
  /** Maximum number of events to store (default: 10000) */
  maxSize?: number;
}

/**
 * In-memory implementation of EventStore.
 *
 * Features:
 * - O(1) lookup by ID
 * - Configurable max size with automatic eviction of oldest events
 * - Efficient filtering by event type
 */
export class InMemoryEventStore implements EventStore {
  private readonly events: Map<string, MAPEvent> = new Map();
  private readonly eventOrder: string[] = [];
  private readonly maxSize: number;

  constructor(options: InMemoryEventStoreOptions = {}) {
    this.maxSize = options.maxSize ?? 10000;
  }

  /**
   * Append an event to storage.
   * Evicts oldest events if max size is exceeded.
   */
  append(event: MAPEvent): void {
    // If event already exists, don't add it again
    if (this.events.has(event.id)) {
      return;
    }

    // Evict oldest events if at capacity
    while (this.eventOrder.length >= this.maxSize && this.eventOrder.length > 0) {
      const oldestId = this.eventOrder.shift()!;
      this.events.delete(oldestId);
    }

    // Add new event
    this.events.set(event.id, event);
    this.eventOrder.push(event.id);
  }

  /**
   * Query events matching filter criteria.
   */
  query(filter: EventFilter): MAPEvent[] {
    let results: MAPEvent[] = [];

    // Get all events in order
    for (const id of this.eventOrder) {
      const event = this.events.get(id);
      if (!event) continue;

      // Filter by types
      if (filter.types && filter.types.length > 0) {
        if (!filter.types.includes(event.type)) {
          continue;
        }
      }

      // Filter by since (exclusive - events after this ID)
      if (filter.since) {
        if (compareUlid(event.id, filter.since) <= 0) {
          continue;
        }
      }

      // Filter by until (inclusive - events up to and including this ID)
      if (filter.until) {
        if (compareUlid(event.id, filter.until) > 0) {
          continue;
        }
      }

      results.push(event);

      // Limit results
      if (filter.limit && results.length >= filter.limit) {
        break;
      }
    }

    return results;
  }

  /**
   * Get a specific event by ID.
   */
  getById(id: string): MAPEvent | undefined {
    return this.events.get(id);
  }

  /**
   * Clear all events.
   */
  clear(): void {
    this.events.clear();
    this.eventOrder.length = 0;
  }

  /**
   * Get the current number of stored events.
   */
  get size(): number {
    return this.events.size;
  }
}
