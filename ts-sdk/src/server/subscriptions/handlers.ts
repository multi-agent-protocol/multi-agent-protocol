/**
 * Subscription handler factories
 *
 * Creates JSON-RPC handlers for subscription-related methods.
 */

import type {
  SubscriptionManager,
  EventBus,
  HandlerContext,
  HandlerRegistry,
  SubscriptionFilter,
} from "../types";

/**
 * Options for creating subscription handlers.
 */
export interface SubscriptionHandlerOptions {
  subscriptions: SubscriptionManager;
  eventBus: EventBus;
}

/**
 * Parameters for subscribing.
 */
interface SubscribeParams {
  filter: SubscriptionFilter;
  startAfter?: string;
}

/**
 * Parameters for unsubscribing.
 */
interface UnsubscribeParams {
  subscriptionId: string;
}

/**
 * Parameters for replaying events.
 */
interface ReplayParams {
  subscriptionId: string;
  since?: string;
  until?: string;
  limit?: number;
}

/**
 * Parameters for acknowledging events.
 */
interface AcknowledgeParams {
  subscriptionId: string;
  eventId: string;
}

/**
 * Parameters for pausing/resuming.
 */
interface PauseResumeParams {
  subscriptionId: string;
}

/**
 * Create handlers for subscription-related methods.
 *
 * Methods:
 * - `map/subscribe` - Create a new subscription
 * - `map/unsubscribe` - Cancel a subscription
 * - `map/replay` - Replay historical events
 * - `map/ack` - Acknowledge received events
 * - `map/pause` - Pause event delivery
 * - `map/resume` - Resume event delivery
 */
export function createSubscriptionHandlers(
  options: SubscriptionHandlerOptions
): HandlerRegistry {
  const { subscriptions, eventBus } = options;

  return {
    "map/subscribe": async (params: unknown, ctx: HandlerContext) => {
      const { filter, startAfter } = params as SubscribeParams;

      const subscription = subscriptions.create({
        sessionId: ctx.session.id,
        filter,
        startAfter,
      });

      // Track subscription in session
      ctx.session.subscriptionIds.push(subscription.id);

      // Return protocol-compliant response
      return { subscriptionId: subscription.id };
    },

    "map/unsubscribe": async (params: unknown, ctx: HandlerContext) => {
      const { subscriptionId } = params as UnsubscribeParams;

      const success = subscriptions.cancel(subscriptionId);
      if (!success) {
        throw new Error(`Subscription not found: ${subscriptionId}`);
      }

      // Remove from session tracking
      const index = ctx.session.subscriptionIds.indexOf(subscriptionId);
      if (index !== -1) {
        ctx.session.subscriptionIds.splice(index, 1);
      }

      return { success: true };
    },

    "map/replay": async (params: unknown) => {
      const { subscriptionId, since, until, limit } = params as ReplayParams;

      // Get subscription to find its filter
      const subscription = subscriptions.get(subscriptionId);
      if (!subscription) {
        throw new Error(`Subscription not found: ${subscriptionId}`);
      }

      // Query events from the event bus
      const events = eventBus.getEvents({
        types: subscription.filter.eventTypes,
        since,
        until,
        limit: limit ?? 100,
      });

      return events;
    },

    "map/ack": async (params: unknown) => {
      const { subscriptionId, eventId } = params as AcknowledgeParams;
      subscriptions.acknowledge(subscriptionId, eventId);
      return { success: true };
    },

    "map/pause": async (params: unknown) => {
      const { subscriptionId } = params as PauseResumeParams;
      subscriptions.pause(subscriptionId);
      return { success: true };
    },

    "map/resume": async (params: unknown) => {
      const { subscriptionId } = params as PauseResumeParams;
      subscriptions.resume(subscriptionId);
      return { success: true };
    },
  };
}
