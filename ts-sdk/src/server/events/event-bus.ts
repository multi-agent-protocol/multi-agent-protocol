/**
 * EventBus implementation
 *
 * Central event dispatcher for the MAP server SDK.
 */

import type {
  MAPEvent,
  EventFilter,
  EventStore,
  EventHandler,
  EventBus,
  EventBusOptions,
} from "../types";
import { ulid } from "../../utils/ulid";
import { InMemoryEventStore } from "./stores/in-memory";

/**
 * Internal subscription tracking
 */
interface Subscription {
  types: Set<string>;
  handler: EventHandler;
}

/**
 * EventBus implementation.
 *
 * Central event dispatcher that:
 * - Assigns ULID and timestamp to emitted events
 * - Stores events in the configured store
 * - Notifies registered handlers synchronously
 * - Supports wildcard subscriptions with '*'
 */
export class EventBusImpl implements EventBus {
  readonly store: EventStore;
  private readonly subscriptions: Map<number, Subscription> = new Map();
  private nextSubscriptionId = 0;

  constructor(options: EventBusOptions = {}) {
    this.store = options.store ?? new InMemoryEventStore();
  }

  /**
   * Emit an event.
   *
   * - Assigns a ULID for the event ID
   * - Sets the timestamp to current time
   * - Stores the event
   * - Notifies all matching handlers synchronously
   *
   * @returns The complete event with ID and timestamp
   */
  emit(event: Omit<MAPEvent, "id" | "timestamp">): MAPEvent {
    const completeEvent: MAPEvent = {
      ...event,
      id: ulid(),
      timestamp: Date.now(),
    };

    // Store the event
    this.store.append(completeEvent);

    // Notify handlers synchronously
    for (const subscription of this.subscriptions.values()) {
      if (this.matchesSubscription(completeEvent, subscription)) {
        try {
          subscription.handler(completeEvent);
        } catch (error) {
          // Log but don't throw - one handler failing shouldn't affect others
          console.error("EventBus handler error:", error);
        }
      }
    }

    return completeEvent;
  }

  /**
   * Subscribe to events by type.
   *
   * @param types Event type(s) to listen for, or '*' for all events
   * @param handler Callback invoked for each matching event
   * @returns Unsubscribe function
   */
  on(types: string | string[], handler: EventHandler): () => void {
    const typeSet = new Set(Array.isArray(types) ? types : [types]);
    const subscriptionId = this.nextSubscriptionId++;

    this.subscriptions.set(subscriptionId, {
      types: typeSet,
      handler,
    });

    // Return unsubscribe function
    return () => {
      this.subscriptions.delete(subscriptionId);
    };
  }

  /**
   * Query historical events from the store.
   */
  getEvents(filter: EventFilter): MAPEvent[] {
    return this.store.query(filter);
  }

  /**
   * Check if an event matches a subscription.
   */
  private matchesSubscription(
    event: MAPEvent,
    subscription: Subscription
  ): boolean {
    // Wildcard matches all events
    if (subscription.types.has("*")) {
      return true;
    }

    // Check for exact type match
    if (subscription.types.has(event.type)) {
      return true;
    }

    // Check for prefix matches (e.g., "agent.*" matches "agent.registered")
    for (const type of subscription.types) {
      if (type.endsWith(".*")) {
        const prefix = type.slice(0, -2);
        if (event.type.startsWith(prefix + ".")) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get the number of active subscriptions.
   */
  get subscriptionCount(): number {
    return this.subscriptions.size;
  }
}
