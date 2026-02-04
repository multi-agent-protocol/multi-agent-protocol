/**
 * In-memory SubscriptionStore implementation
 */

import type { ServerSubscription, SubscriptionStore } from "../../types";

/**
 * In-memory implementation of SubscriptionStore.
 */
export class InMemorySubscriptionStore implements SubscriptionStore {
  private readonly subscriptions: Map<string, ServerSubscription> = new Map();

  /**
   * Save a subscription (create or update).
   */
  save(subscription: ServerSubscription): void {
    this.subscriptions.set(subscription.id, { ...subscription });
  }

  /**
   * Get subscription by ID.
   */
  get(id: string): ServerSubscription | undefined {
    const subscription = this.subscriptions.get(id);
    return subscription ? { ...subscription } : undefined;
  }

  /**
   * List subscriptions matching filter criteria.
   */
  list(filter?: { sessionId?: string }): ServerSubscription[] {
    const results: ServerSubscription[] = [];

    for (const subscription of this.subscriptions.values()) {
      if (filter?.sessionId !== undefined && subscription.sessionId !== filter.sessionId) {
        continue;
      }
      results.push({ ...subscription });
    }

    return results;
  }

  /**
   * Delete a subscription by ID.
   */
  delete(id: string): boolean {
    return this.subscriptions.delete(id);
  }

  /**
   * Clear all subscriptions.
   */
  clear(): void {
    this.subscriptions.clear();
  }

  /**
   * Atomically update the lastEventId for a subscription.
   * This method performs a single atomic read-modify-write operation.
   * @returns The updated subscription, or undefined if not found
   */
  updateLastEventId(id: string, eventId: string): ServerSubscription | undefined {
    const subscription = this.subscriptions.get(id);
    if (!subscription) {
      return undefined;
    }
    // Atomic update - directly mutate the stored object
    subscription.lastEventId = eventId;
    return { ...subscription };
  }

  /**
   * Get the number of stored subscriptions.
   */
  get size(): number {
    return this.subscriptions.size;
  }
}
